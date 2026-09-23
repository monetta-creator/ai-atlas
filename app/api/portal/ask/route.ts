import Anthropic from '@anthropic-ai/sdk';
import { isPortal } from '@/lib/auth';
import { askSystem, conversationMessages } from '@/lib/ask/prompt';
import { encodeDecline } from '@/lib/ask/lanes';
import { laneHeaders, resolveLane } from '@/lib/ask/resolve-lane';
import { streamQuickAnswer } from '@/lib/ask/quick-stream';
import { clampHistory, clampSignalOffset, parseAskBody } from '@/lib/ask/history';
import { checkPortalBudget, PORTAL_CLASSIFY_FEATURE, PORTAL_FEATURE } from '@/lib/portal/budget';

// The team Ask endpoint: /api/ask's envelope with four diffs.
// 1. Gate: the portal cookie (shared team key), not admin. This is the one
//    surface where a non-admin triggers a billable model call, so
// 2. every call (i.e. every TURN of a conversation) first passes the daily
//    budget check (lib/portal/budget.ts), and
// 3. retrieval runs in guest-safe portal mode (no personal layer, published
//    signals only, article excerpts included), and
// 4. cost is metered under its own feature slug so the budget query and the
//    /costs dashboard see portal spend separately.
// Multi-turn contract identical to /api/ask (lib/ask/history.ts).
// Node runtime required (pg pool); allow-listed in proxy.ts.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  if (!(await isPortal())) {
    return new Response(
      'This surface needs the team portal key. Unlock it at /ask.',
      { status: 401, headers: TEXT_HEADERS }
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the empty-body guard
  }
  const parsed = parseAskBody(body);
  if (!parsed) return new Response('Empty query', { status: 400 });
  const msgs = clampHistory(parsed);
  const tagStart = clampSignalOffset((body as { signalOffset?: unknown })?.signalOffset);
  // Portal keyholders get the web toggle too; each search adds a flat
  // surcharge in lib/cost.ts, so the daily budget check absorbs it naturally.
  const webOn = Boolean((body as { web?: unknown })?.web);

  const budget = await checkPortalBudget();
  if (!budget.ok) {
    return new Response(
      'The Atlas has answered a lot of questions today and has reached its daily budget. It resets at midnight UTC. Dataset downloads still work.',
      { headers: TEXT_HEADERS }
    );
  }

  const { ctx, cls, lane, autoWeb, decline } = await resolveLane(msgs, {
    mode: 'portal', tagStart, classifyFeature: PORTAL_CLASSIFY_FEATURE,
  });
  const useWeb = webOn || autoWeb;
  const headers = { ...TEXT_HEADERS, ...laneHeaders(lane, ctx.signalRefs) };

  if (decline) return new Response(encodeDecline(decline), { headers });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });

  return new Response(streamQuickAnswer({
    client,
    model: MODEL,
    system: askSystem(useWeb, lane, cls.fresh),
    messages: conversationMessages(msgs, ctx, { web: useWeb, lane }),
    useWeb,
    feature: PORTAL_FEATURE,
  }), { headers });
}

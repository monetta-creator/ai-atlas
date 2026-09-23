import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { askSystem, conversationMessages } from '@/lib/ask/prompt';
import { encodeDecline } from '@/lib/ask/lanes';
import { laneHeaders, resolveLane } from '@/lib/ask/resolve-lane';
import { streamQuickAnswer } from '@/lib/ask/quick-stream';
import { clampHistory, clampSignalOffset, parseAskBody } from '@/lib/ask/history';
import { checkKeyBudget, checkPortalBudget, PORTAL_CLASSIFY_FEATURE, PORTAL_FEATURE } from '@/lib/portal/budget';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { logPortalUsage } from '@/lib/mutations/portal';

// The team Ask endpoint: /api/ask's envelope with four diffs.
// 1. Gate: the portal identity (lib/portal/identity.ts: admin cookie, the
//    legacy team-key cookie, or a per-person access key by cookie or header),
//    not admin. This is the one surface where a non-admin triggers a billable
//    model call, so
// 2. every call (i.e. every TURN of a conversation) first passes the portal's
//    daily budget check and, for a per-person key, that key's own daily cap
//    (lib/portal/budget.ts), and
// 3. retrieval runs in guest-safe portal mode (no personal layer, published
//    signals only, article excerpts included), and
// 4. cost is metered under its own feature slug so the budget query and the
//    /costs dashboard see portal spend separately; per-key calls also stamp
//    metadata.portal_key_id, which is what the per-key sum reads.
// Multi-turn contract identical to /api/ask (lib/ask/history.ts).
// Node runtime required (pg pool); allow-listed in proxy.ts.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return new Response(denied.body.message, {
      status: denied.status,
      headers: { ...TEXT_HEADERS, 'X-Atlas-Key-State': denied.headers['X-Atlas-Key-State'] },
    });
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
  const keyId = identity.tier === 'key' ? identity.keyId : null;
  if (keyId) {
    const own = await checkKeyBudget(keyId);
    if (!own.ok) {
      return new Response(
        'Your access key has reached its daily Ask budget. It resets at midnight UTC. Dataset downloads still work.',
        { headers: TEXT_HEADERS }
      );
    }
  }
  const metadata = keyId ? { portal_key_id: keyId } : undefined;

  const { ctx, cls, lane, autoWeb, decline } = await resolveLane(msgs, {
    mode: 'portal', tagStart, classifyFeature: PORTAL_CLASSIFY_FEATURE, classifyMetadata: metadata,
  });
  const useWeb = webOn || autoWeb;
  const headers = { ...TEXT_HEADERS, ...laneHeaders(lane, ctx.signalRefs) };

  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  after(() => Promise.all([
    logPortalUsage({
      keyId,
      identity: identity.tier === 'key' ? 'key' : identity.tier === 'admin' ? 'admin' : 'legacy',
      kind: 'ask',
      spec: { lane, web: useWeb, turns: msgs.length },
      status: 200,
      ua,
    }),
    touchKey(keyId),
  ]));

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
    metadata,
  }), { headers });
}

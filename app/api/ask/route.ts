import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { askSystem, conversationMessages } from '@/lib/ask/prompt';
import { encodeDecline } from '@/lib/ask/lanes';
import { laneHeaders, resolveLane } from '@/lib/ask/resolve-lane';
import { streamQuickAnswer } from '@/lib/ask/quick-stream';
import { clampHistory, clampSignalOffset, parseAskBody } from '@/lib/ask/history';

// "Ask the Atlas" streaming endpoint, admin mode (personal layer allowed in
// retrieval). Multi-turn: accepts { messages: [{role, content}], signalOffset }
// with the legacy { query } shape still honored (lib/ask/history.ts). Retrieval
// runs fresh per turn; prior turns ride as plain text; signal tags continue
// from the client's offset so citations in earlier turns never mislink.
//
// Node runtime (the default) is required: retrieval uses lib/db's pg pool,
// which needs Node TCP sockets and cannot run on the Edge runtime. Do NOT set
// runtime = 'edge'. maxDuration covers the model leg.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Start on Haiku for speed (a single MODEL constant so escalating a hard,
// multi-record question to Sonnet later is a one-line change).
const MODEL = 'claude-haiku-4-5';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  // Admin-only: the proxy admits a guest cookie, so the endpoint is the real gate.
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

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
  // The composer's web-search toggle: records stay primary, the web fills gaps.
  const webOn = Boolean((body as { web?: unknown })?.web);

  const { ctx, cls, lane, autoWeb, decline } = await resolveLane(msgs, { mode: 'admin', tagStart });
  const useWeb = webOn || autoWeb;
  // Resolve [signal Sn] citations client-side: ship the per-request tag -> uuid map.
  const headers = { ...TEXT_HEADERS, ...laneHeaders(lane, ctx.signalRefs) };

  // Unrelated: a coded decline, no model call, no cost row.
  if (decline) return new Response(encodeDecline(decline), { headers });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  // Tight timeout, no in-call retries: stay well under the function cap.
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });

  return new Response(streamQuickAnswer({
    client,
    model: MODEL,
    system: askSystem(useWeb, lane, cls.fresh),
    messages: conversationMessages(msgs, ctx, { web: useWeb, lane }),
    useWeb,
    feature: 'ask',
  }), { headers });
}

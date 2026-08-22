import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { priceUsage, recordApiCall } from '@/lib/cost';
import { buildAskContext } from '@/lib/ask/retrieve';
import { askSystem, conversationMessages } from '@/lib/ask/prompt';
import {
  clampHistory, clampSignalOffset, parseAskBody, retrievalQuery,
  encodeCostReport,
} from '@/lib/ask/history';

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

  const ctx = await buildAskContext(retrievalQuery(msgs), { mode: 'admin', tagStart });
  const enc = new TextEncoder();
  // Resolve [signal Sn] citations client-side: ship the per-request tag -> uuid map.
  const headers = {
    ...TEXT_HEADERS,
    'X-Ask-Signals': JSON.stringify(Object.fromEntries(ctx.signalRefs.map((r) => [r.tag, r.id]))),
  };

  // No retrieval hits on the OPENING turn: short-circuit with the canned
  // refusal, no model call. Follow-ups proceed regardless ("summarize that"
  // legitimately matches nothing) with the none-matched query block.
  if (ctx.hitCount === 0 && msgs.length === 1) {
    return new Response(
      'Not in the Atlas. Nothing in the Atlas matched that. Try a topic or a hypothesis code.',
      { headers }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  // Tight timeout, no in-call retries: stay well under the function cap.
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      try {
        const ms = client.messages.stream({
          model: MODEL,
          max_tokens: 1500,
          system: [{ type: 'text', text: askSystem(), cache_control: { type: 'ephemeral' } }],
          messages: conversationMessages(msgs, ctx),
        });
        // Enforce the house no-em-dash rule on live output (Haiku occasionally
        // slips one in despite the prompt). En dashes (ranges, nulls) are left alone.
        ms.on('text', (delta) => controller.enqueue(enc.encode(delta.replace(/\s*—\s*/g, ', '))));
        const final = await ms.finalMessage();
        // The per-turn cost line rides a trailing sentinel; the client strips it.
        const usage = final.usage as {
          input_tokens?: number | null; output_tokens?: number | null;
          cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
        };
        const costUsd = await priceUsage(MODEL, final.usage);
        controller.enqueue(enc.encode(encodeCostReport({
          cost_usd: costUsd,
          input_tokens:
            (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
          output_tokens: usage.output_tokens ?? 0,
          cache_read_tokens: usage.cache_read_input_tokens ?? 0,
          searches: 0,
          rounds: 1,
          model: MODEL,
        })));
        await recordApiCall({ feature: 'ask', model: MODEL, usage: final.usage, wallMs: Date.now() - t0 });
      } catch {
        controller.enqueue(enc.encode('\n\nThe answer could not be completed. Please try again.'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers });
}

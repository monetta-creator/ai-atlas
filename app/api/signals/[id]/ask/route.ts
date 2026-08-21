import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { priceUsage, recordApiCall } from '@/lib/cost';
import { encodeCostReport } from '@/lib/ask/history';
import { buildSignalAskContext } from '@/lib/signal-ask';

// "Ask this signal" streaming endpoint, scoped to one signal. Node runtime (default) is
// required: retrieval uses lib/db's pg pool. Mirrors /api/ask but with a per-signal context
// (its summary, source text, and touched claims) instead of the whole-Atlas retrieval.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Admin-only: the proxy admits a guest cookie, so the endpoint is the real gate (this is a
  // live per-question LLM call, deliberately not exposed to guests).
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;

  let query = '';
  try {
    const body = await req.json();
    if (typeof body?.query === 'string') query = body.query.trim();
  } catch {
    // fall through to the empty-query guard
  }
  if (!query) return new Response('Empty query', { status: 400 });
  if (query.length > 2000) query = query.slice(0, 2000);

  const ctxData = await buildSignalAskContext(id, query);
  if (!ctxData.found) return new Response('Signal not found', { status: 404 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  // Tight timeout, no in-call retries: stay well under the 60s function cap.
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      try {
        const ms = client.messages.stream({
          model: MODEL,
          max_tokens: 1200,
          system: [{ type: 'text', text: ctxData.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: ctxData.user }],
        });
        // Enforce the house no-em-dash rule on live output (Haiku occasionally slips one in).
        ms.on('text', (delta) => controller.enqueue(enc.encode(delta.replace(/\s*—\s*/g, ', '))));
        const final = await ms.finalMessage();
        // The per-turn cost line rides a trailing sentinel; AskAtlas strips it.
        const u = final.usage;
        controller.enqueue(enc.encode(encodeCostReport({
          cost_usd: await priceUsage(MODEL, final.usage),
          input_tokens:
            (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          output_tokens: u.output_tokens ?? 0,
          cache_read_tokens: u.cache_read_input_tokens ?? 0,
          searches: 0,
          rounds: 1,
          model: MODEL,
        })));
        await recordApiCall({
          feature: 'signal_ask', model: MODEL, usage: final.usage, wallMs: Date.now() - t0,
          metadata: { signal_id: id },
        });
      } catch {
        controller.enqueue(enc.encode('\n\nThe answer could not be completed. Please try again.'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: TEXT_HEADERS });
}

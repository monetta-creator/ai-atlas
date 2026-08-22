import Anthropic from '@anthropic-ai/sdk';
import { isPortal } from '@/lib/auth';
import { priceUsage, recordApiCall } from '@/lib/cost';
import { buildAskContext } from '@/lib/ask/retrieve';
import { askSystem, conversationMessages } from '@/lib/ask/prompt';
import {
  clampHistory, clampSignalOffset, parseAskBody, retrievalQuery,
  encodeCostReport,
} from '@/lib/ask/history';
import { checkPortalBudget, PORTAL_FEATURE } from '@/lib/portal/budget';

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

  const budget = await checkPortalBudget();
  if (!budget.ok) {
    return new Response(
      'The Atlas has answered a lot of questions today and has reached its daily budget. It resets at midnight UTC. Dataset downloads still work.',
      { headers: TEXT_HEADERS }
    );
  }

  const ctx = await buildAskContext(retrievalQuery(msgs), { mode: 'portal', tagStart });
  const enc = new TextEncoder();
  const headers = {
    ...TEXT_HEADERS,
    'X-Ask-Signals': JSON.stringify(Object.fromEntries(ctx.signalRefs.map((r) => [r.tag, r.id]))),
  };

  if (ctx.hitCount === 0 && msgs.length === 1) {
    return new Response(
      'Not in the Atlas. Nothing in the Atlas matched that. Try a topic or a hypothesis code.',
      { headers }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
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
        await recordApiCall({ feature: PORTAL_FEATURE, model: MODEL, usage: final.usage, wallMs: Date.now() - t0 });
      } catch {
        controller.enqueue(enc.encode('\n\nThe answer could not be completed. Please try again.'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers });
}

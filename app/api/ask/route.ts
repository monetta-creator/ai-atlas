import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { recordApiCall } from '@/lib/cost';
import { buildAskContext } from '@/lib/ask/retrieve';
import { ASK_SYSTEM, WEB_ADDENDUM, conversationMessages } from '@/lib/ask/prompt';
import {
  clampHistory, clampSignalOffset, parseAskBody, retrievalQuery,
  collectWebSources, encodeWebSources,
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
  // The composer's web-search toggle: records stay primary, the web fills gaps.
  const webOn = Boolean((body as { web?: unknown })?.web);

  const ctx = await buildAskContext(retrievalQuery(msgs), { mode: 'admin', tagStart });
  const enc = new TextEncoder();
  // Resolve [signal Sn] citations client-side: ship the per-request tag -> uuid map.
  const headers = {
    ...TEXT_HEADERS,
    'X-Ask-Signals': JSON.stringify(Object.fromEntries(ctx.signalRefs.map((r) => [r.tag, r.id]))),
  };

  // No retrieval hits on the OPENING turn: short-circuit with the canned
  // refusal, no model call. Follow-ups proceed regardless ("summarize that"
  // legitimately matches nothing) with the none-matched query block. With web
  // search on there is no short-circuit: gap-filling is the toggle's job.
  if (ctx.hitCount === 0 && msgs.length === 1 && !webOn) {
    return new Response(
      'Not in the Atlas. Nothing in the Atlas matched that. Try a topic, a claim code like 2.3, or a concept name.',
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
        const params = {
          model: MODEL,
          max_tokens: 1500,
          system: [{ type: 'text', text: webOn ? ASK_SYSTEM + WEB_ADDENDUM : ASK_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: conversationMessages(msgs, ctx),
          // The raw web-search tool object is not in the SDK Tool union, hence
          // the double-cast below (the lib/pipeline/web.ts pattern).
          ...(webOn
            ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] }
            : {}),
        };
        const ms = client.messages.stream(
          params as unknown as Parameters<typeof client.messages.stream>[0]
        );
        // Cited web sources are captured from the RAW stream events
        // (citations_delta), not from finalMessage(): the pinned SDK's stream
        // accumulator predates server-tool blocks and drops both the tool
        // results and the citations. Raw wire events pass through regardless.
        const webSources: { url: string; title: string }[] = [];
        const seenSrc = new Set<string>();
        const addSource = (c?: { type?: string; url?: string; title?: string | null }) => {
          if (!c || c.type !== 'web_search_result_location' || !c.url || seenSrc.has(c.url)) return;
          seenSrc.add(c.url);
          webSources.push({ url: c.url.slice(0, 600), title: String(c.title ?? '').slice(0, 200) || c.url });
        };
        if (webOn) {
          ms.on('streamEvent', (ev) => {
            const e = ev as {
              type?: string;
              content_block?: { type?: string; content?: { type?: string; url?: string; title?: string | null }[] };
              delta?: { type?: string; citation?: { type?: string; url?: string; title?: string | null } };
            };
            // Explicit citations when the model quotes (rare on Haiku)...
            if (e.type === 'content_block_delta' && e.delta?.type === 'citations_delta') addSource(e.delta.citation);
            // ...and the search results themselves as the reliable fallback:
            // the web_search_tool_result block arrives whole at block start.
            if (e.type === 'content_block_start' && e.content_block?.type === 'web_search_tool_result'
                && Array.isArray(e.content_block.content)) {
              for (const r of e.content_block.content.slice(0, 3)) {
                if (r?.type === 'web_search_result') addSource({ type: 'web_search_result_location', url: r.url, title: r.title });
              }
            }
          });
        }
        // Enforce the house no-em-dash rule on live output (Haiku occasionally
        // slips one in despite the prompt). En dashes (ranges, nulls) are left alone.
        ms.on('text', (delta) => controller.enqueue(enc.encode(delta.replace(/\s*—\s*/g, ', '))));
        const final = await ms.finalMessage();
        if (webOn) {
          // Belt and braces: merge anything a future SDK's accumulator sees.
          for (const s of collectWebSources(final)) addSource({ type: 'web_search_result_location', ...s });
          // The sources ride a trailing sentinel line (headers are long gone);
          // the client strips it and renders the source strip.
          if (webSources.length) controller.enqueue(enc.encode(encodeWebSources(webSources.slice(0, 8))));
        }
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

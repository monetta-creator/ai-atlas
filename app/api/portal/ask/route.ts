import Anthropic from '@anthropic-ai/sdk';
import { isPortal } from '@/lib/auth';
import { recordApiCall } from '@/lib/cost';
import { buildAskContext } from '@/lib/ask/retrieve';
import { ASK_SYSTEM, WEB_ADDENDUM, conversationMessages } from '@/lib/ask/prompt';
import {
  clampHistory, clampSignalOffset, parseAskBody, retrievalQuery,
  collectWebSources, encodeWebSources,
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

  const ctx = await buildAskContext(retrievalQuery(msgs), { mode: 'portal', tagStart });
  const enc = new TextEncoder();
  const headers = {
    ...TEXT_HEADERS,
    'X-Ask-Signals': JSON.stringify(Object.fromEntries(ctx.signalRefs.map((r) => [r.tag, r.id]))),
  };

  if (ctx.hitCount === 0 && msgs.length === 1 && !webOn) {
    return new Response(
      'Not in the Atlas. Nothing in the Atlas matched that. Try a topic, a claim code like 2.3, or a concept name.',
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
        const params = {
          model: MODEL,
          max_tokens: 1500,
          system: [{ type: 'text', text: webOn ? ASK_SYSTEM + WEB_ADDENDUM : ASK_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: conversationMessages(msgs, ctx),
          ...(webOn
            ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] }
            : {}),
        };
        const ms = client.messages.stream(
          params as unknown as Parameters<typeof client.messages.stream>[0]
        );
        // Web sources come from the RAW stream's citations_delta events; the
        // pinned SDK's accumulator drops server-tool blocks (see /api/ask).
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
            if (e.type === 'content_block_delta' && e.delta?.type === 'citations_delta') addSource(e.delta.citation);
            if (e.type === 'content_block_start' && e.content_block?.type === 'web_search_tool_result'
                && Array.isArray(e.content_block.content)) {
              for (const r of e.content_block.content.slice(0, 3)) {
                if (r?.type === 'web_search_result') addSource({ type: 'web_search_result_location', url: r.url, title: r.title });
              }
            }
          });
        }
        ms.on('text', (delta) => controller.enqueue(enc.encode(delta.replace(/\s*—\s*/g, ', '))));
        const final = await ms.finalMessage();
        if (webOn) {
          for (const s of collectWebSources(final)) addSource({ type: 'web_search_result_location', ...s });
          if (webSources.length) controller.enqueue(enc.encode(encodeWebSources(webSources.slice(0, 8))));
        }
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

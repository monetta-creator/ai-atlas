import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { q } from '@/lib/db';
import { priceUsage, recordApiCall, type ApiUsage } from '@/lib/cost';
import { loadNamespace } from '@/lib/ask/retrieve';
import { askSystem, deepConversationMessages } from '@/lib/ask/prompt';
import { clampHistory, clampSignalOffset, parseAskBody, type AskWebSource } from '@/lib/ask/history';
import { fetchRecord, searchArticles, searchAtlas } from '@/lib/ask/search';
import {
  DEEP_ADDENDUM, DEEP_TOOLS, DEEP_WEB_ADDENDUM, INPUT_TOKEN_CAP, MAX_CALLS_PER_ROUND, MAX_ROUNDS,
  VERIFY_INSTRUCTION, VERIFY_TOOL, type VerifyReport,
  citeToken, createTagger, ndCost, ndDelta, ndDone, ndError, ndStatus, ndVerify, ndWebSources,
  parseFetchRecordInput, parseSearchArticlesInput, parseSearchAtlasInput, parseSignalMap,
  parseVerifyOutput, renderArticleHits, renderRecord, renderSearchHits, runDeterministicChecks,
  STATUS_START, STATUS_VERIFYING, STATUS_WRITING, statusArticles, statusRead, statusRound, statusSearch,
} from '@/lib/ask/deep';

// "Ask the Atlas" research chat: an agentic tool-use loop over the Atlas
// (search_atlas / fetch_record / search_articles, all backed by lib/ask/search),
// optionally the web_search server tool (the composer's web toggle), followed
// by a forced streamed answer. Since the 2026-08-21 rework this is the DEFAULT
// admin chat behind /ask, not a toggle; the quick route stays for the portal
// and the per-signal widget.
//
// The response is NDJSON (lib/ask/deep.ts): status lines while researching,
// delta lines for the answer, web_sources / verify / cost lines, and a
// terminal done line with the signal tag map.
//
// maxDuration 300 is the measured Fluid Compute ceiling (see /api/probe/duration
// and docs/data-portal-upgrade-paths.md), not the old assumed 60. The loop
// still guards itself on wall clock, rounds, calls, and context size so a slow
// session degrades to "answer with what you have", never a dead connection.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODEL = 'claude-haiku-4-5';
const FEATURE = 'ask_deep';
const DEADLINE_MS = 280_000; // total research + answer budget inside maxDuration
const FINAL_RESERVE_MS = 60_000; // stop researching when less than this remains
const NDJSON_HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' };

const scrub = (s: string): string => s.replace(/\s*—\s*/g, ', ');

export async function POST(req: Request): Promise<Response> {
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
  const b = body as { signalOffset?: unknown; signalMap?: unknown; web?: unknown };
  const tagger = createTagger(parseSignalMap(b?.signalMap), clampSignalOffset(b?.signalOffset));
  const webOn = Boolean(b?.web);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  const client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });

  const ns = await loadNamespace();
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${askSystem(webOn)}\n\n${DEEP_ADDENDUM}${webOn ? `\n\n${DEEP_WEB_ADDENDUM}` : ''}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  const convo: Anthropic.MessageParam[] = deepConversationMessages(msgs, ns, { web: webOn });
  // The web_search server tool is not in the pinned SDK's Tool union, hence the
  // cast (the lib/pipeline/web.ts pattern). One tools array for every call.
  const tools = (
    webOn
      ? [...DEEP_TOOLS, { type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
      : DEEP_TOOLS
  ) as unknown as Anthropic.Tool[];

  const enc = new TextEncoder();
  const t0 = Date.now();
  const deadline = t0 + DEADLINE_MS;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // After a client disconnect enqueue throws; research still winds down
      // via the abort checks below, and emits become no-ops.
      const emit = (line: string) => {
        try {
          controller.enqueue(enc.encode(line));
        } catch {
          // client gone
        }
      };

      // One tool call. Validation failures and misses go back to the model as
      // is_error results so a malformed call self-corrects on the next round.
      async function execTool(name: string, input: unknown): Promise<{ text: string; isError?: boolean }> {
        if (name === 'search_atlas') {
          const p = parseSearchAtlasInput(input);
          if (typeof p === 'string') return { text: p, isError: true };
          const hits = await searchAtlas(q, p.query, {
            kinds: p.kinds, limit: p.limit, admin: true,
            tagFor: tagger.tagFor, paperTagFor: tagger.paperTagFor,
          });
          emit(ndStatus(scrub(statusSearch(p.query, hits.length))));
          return { text: renderSearchHits(hits) };
        }
        if (name === 'fetch_record') {
          const p = parseFetchRecordInput(input);
          if (typeof p === 'string') return { text: p, isError: true };
          let dbId = p.id;
          if (p.kind === 'signal' || p.kind === 'paper') {
            const uuid = tagger.idFor(p.id);
            if (!uuid) {
              return { text: `Unknown ${p.kind} tag ${p.id}. Use a tag from a result in this conversation.`, isError: true };
            }
            dbId = uuid;
          }
          const payload = await fetchRecord(q, p.kind, dbId, { admin: true });
          if (!payload) return { text: `No ${p.kind} found with id ${p.id}.`, isError: true };
          emit(ndStatus(statusRead(citeToken(p.kind, p.id))));
          return { text: renderRecord(payload, p.id, tagger.tagFor) };
        }
        if (name === 'search_articles') {
          const p = parseSearchArticlesInput(input);
          if (typeof p === 'string') return { text: p, isError: true };
          const hits = await searchArticles(q, p.query, { tagFor: tagger.tagFor });
          emit(ndStatus(scrub(statusArticles(p.query, hits.length))));
          return { text: renderArticleHits(hits) };
        }
        return { text: `Unknown tool ${name}.`, isError: true };
      }

      let rounds = 0;
      let toolCalls = 0;
      let modelCalls = 0;
      let answered = false;
      let streamedAny = false;
      let answerText = '';
      // Everything the model was shown, for the deterministic quote/figure
      // checks: the skeleton plus every successful tool result (web result
      // titles too; the searched page text itself arrives encrypted and never
      // reaches us, which is why the verify report carries webSearched).
      const corpus: string[] = [ns.skeleton];
      // Rolling cache anchor: only the LATEST tool-result block carries a
      // breakpoint (plus system + skeleton), staying under the 4-block limit.
      let lastAnchor: Anthropic.ToolResultBlockParam | null = null;

      // Per-turn totals for the reader-facing cost report (priced once at the
      // end; pricing is linear so summed usage prices like per-call usage).
      const totals: ApiUsage & { server_tool_use: { web_search_requests: number } } = {
        input_tokens: 0, output_tokens: 0,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0 },
      };
      const addUsage = (u: ApiUsage | null | undefined) => {
        if (!u) return;
        totals.input_tokens = (totals.input_tokens ?? 0) + (u.input_tokens ?? 0);
        totals.output_tokens = (totals.output_tokens ?? 0) + (u.output_tokens ?? 0);
        totals.cache_creation_input_tokens =
          (totals.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        totals.cache_read_input_tokens =
          (totals.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        const w = u.server_tool_use?.web_search_requests;
        if (typeof w === 'number' && w > 0) totals.server_tool_use.web_search_requests += w;
      };

      // Cited web sources, from server-tool result blocks (non-streamed loop
      // rounds) and raw stream events (the final leg): the pinned SDK's stream
      // accumulator predates server-tool blocks, so nothing here relies on it.
      const webSources: AskWebSource[] = [];
      const seenSrc = new Set<string>();
      const addSource = (url?: string, title?: string | null) => {
        if (!url || seenSrc.has(url)) return;
        seenSrc.add(url);
        webSources.push({ url: url.slice(0, 600), title: String(title ?? '').slice(0, 200) || url });
      };
      const captureServerBlocks = (content: unknown[]): boolean => {
        let found = false;
        for (const blk of content) {
          const cb = blk as { type?: string; content?: unknown };
          if (cb.type !== 'web_search_tool_result' || !Array.isArray(cb.content)) continue;
          for (const r of cb.content.slice(0, 5)) {
            const rr = r as { type?: string; url?: string; title?: string | null };
            if (rr?.type === 'web_search_result' && rr.url) {
              found = true;
              addSource(rr.url, rr.title);
              corpus.push(`${String(rr.title ?? '')} ${rr.url}`);
            }
          }
        }
        return found;
      };

      try {
        emit(ndStatus(STATUS_START));

        for (let round = 1; round <= MAX_ROUNDS; round++) {
          if (req.signal.aborted) break;
          if (Date.now() > deadline - FINAL_RESERVE_MS) {
            emit(ndStatus('Time budget reached, writing with what is gathered'));
            break;
          }
          const t = Date.now();
          const res = await client.messages.create({
            model: MODEL,
            max_tokens: 1200,
            system,
            tools,
            messages: convo,
          });
          rounds = round;
          modelCalls++;
          addUsage(res.usage as ApiUsage);
          await recordApiCall({
            feature: FEATURE, model: MODEL, usage: res.usage, wallMs: Date.now() - t, metadata: { round },
          });
          if (webOn && captureServerBlocks(res.content as unknown[])) {
            emit(ndStatus('Searched the web'));
          }

          const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
          if (!toolUses.length) {
            // Server-side web searches run INSIDE one API turn, so the turn's
            // text can be narration + search + answer. Only text after the
            // last search-result block is the answer; the earlier text is
            // pre-search narration ("let me search...") and drops.
            const blocks = res.content as { type?: string }[];
            let from = 0;
            for (let i = 0; i < blocks.length; i++) {
              if (blocks[i].type === 'web_search_tool_result') from = i + 1;
            }
            answerText = res.content
              .slice(from)
              .filter((c): c is Anthropic.TextBlock => c.type === 'text')
              .map((c) => c.text)
              .join('');
            // A turn that ran only server-side web searches (or paused mid
            // server tool) is not an answer: continue the conversation so the
            // model can use what it found. Role alternation allows a trailing
            // assistant turn; the API treats it as a continuation.
            const serverOnly = (res.content as { type?: string }[]).some(
              (c) => c.type === 'server_tool_use' || c.type === 'web_search_tool_result'
            );
            const paused = (res as { stop_reason?: string | null }).stop_reason === 'pause_turn';
            if ((paused || (!answerText.trim() && serverOnly)) && round < MAX_ROUNDS) {
              convo.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
              answerText = '';
              continue;
            }
            // The model answered without (more) research; its text is the answer.
            if (answerText.trim()) {
              emit(ndDelta(scrub(answerText)));
              streamedAny = true;
            }
            answered = true;
            break;
          }

          if (round > 1) emit(ndStatus(statusRound(round)));
          convo.push({ role: 'assistant', content: res.content });

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (let i = 0; i < toolUses.length; i++) {
            const tu = toolUses[i];
            let r: { text: string; isError?: boolean };
            if (i >= MAX_CALLS_PER_ROUND) {
              r = { text: 'Call budget for this round exceeded. Use what you have or continue next round.', isError: true };
            } else {
              toolCalls++;
              try {
                r = await execTool(tu.name, tu.input);
              } catch {
                r = { text: 'The tool failed on this call.', isError: true };
              }
              if (!r.isError) corpus.push(r.text);
            }
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: r.text,
              ...(r.isError ? { is_error: true } : {}),
            });
          }
          if (lastAnchor) delete lastAnchor.cache_control;
          lastAnchor = results[results.length - 1];
          lastAnchor.cache_control = { type: 'ephemeral' };
          convo.push({ role: 'user', content: results });

          const u = res.usage;
          const contextTokens =
            (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          if (contextTokens > INPUT_TOKEN_CAP) {
            emit(ndStatus('Context budget reached, writing with what is gathered'));
            break;
          }
        }

        if (!answered && !req.signal.aborted) {
          // Forced final: the finish instruction rides in the same user turn as
          // the last tool results (a trailing sibling user message would break
          // role alternation), and tool_choice none blocks further calls.
          const last = convo[convo.length - 1];
          if (last?.role === 'user' && Array.isArray(last.content)) {
            last.content.push({
              type: 'text',
              text: 'Research is over. Write the final answer now from the records gathered above, following the citation rules. Do not request more tools.',
            });
          }
          emit(ndStatus(STATUS_WRITING));
          const t = Date.now();
          const ms = client.messages.stream(
            {
              model: MODEL,
              max_tokens: 2000,
              system,
              tools,
              tool_choice: { type: 'none' },
              messages: convo,
            },
            { timeout: 55_000, maxRetries: 0 }
          );
          if (webOn) {
            // Raw wire events, never the accumulator: citations when the model
            // quotes, plus the result blocks themselves as the fallback.
            ms.on('streamEvent', (ev) => {
              const e = ev as {
                type?: string;
                content_block?: { type?: string; content?: { type?: string; url?: string; title?: string | null }[] };
                delta?: { type?: string; citation?: { type?: string; url?: string; title?: string | null } };
              };
              if (e.type === 'content_block_delta' && e.delta?.type === 'citations_delta'
                  && e.delta.citation?.type === 'web_search_result_location') {
                addSource(e.delta.citation.url, e.delta.citation.title);
              }
              if (e.type === 'content_block_start' && e.content_block?.type === 'web_search_tool_result'
                  && Array.isArray(e.content_block.content)) {
                for (const r of e.content_block.content.slice(0, 5)) {
                  if (r?.type === 'web_search_result' && r.url) {
                    addSource(r.url, r.title);
                    corpus.push(`${String(r.title ?? '')} ${r.url}`);
                  }
                }
              }
            });
          }
          ms.on('text', (delta) => {
            streamedAny = true;
            emit(ndDelta(scrub(delta)));
          });
          const final = await ms.finalMessage();
          answerText = final.content
            .filter((c): c is Anthropic.TextBlock => c.type === 'text')
            .map((c) => c.text)
            .join('');
          modelCalls++;
          addUsage(final.usage as ApiUsage);
          await recordApiCall({
            feature: FEATURE, model: MODEL, usage: final.usage, wallMs: Date.now() - t,
            metadata: { round: 'final', rounds, tool_calls: toolCalls },
          });
        }

        if (webSources.length && !req.signal.aborted) {
          emit(ndWebSources(webSources.slice(0, 8)));
        }

        // Verification, both layers. Layer 1 (quotes + figures vs the corpus)
        // is deterministic and always runs. Layer 2 rides the cached prefix
        // (the rolling anchor still sits on the last tool results) so the
        // cross-check costs a fraction of a cent; skipped near the deadline or
        // if it fails, in which case the deterministic results still ship.
        if (answerText.trim() && !req.signal.aborted) {
          let report: VerifyReport = { flags: [], ...runDeterministicChecks(answerText, corpus) };
          if (webOn && totals.server_tool_use.web_search_requests > 0) report.webSearched = true;
          if (Date.now() < deadline - 25_000) {
            emit(ndStatus(STATUS_VERIFYING));
            try {
              convo.push({ role: 'assistant', content: answerText });
              convo.push({ role: 'user', content: VERIFY_INSTRUCTION });
              const t = Date.now();
              const vres = await client.messages.create(
                {
                  model: MODEL,
                  max_tokens: 700,
                  system,
                  tools: [...tools, VERIFY_TOOL],
                  tool_choice: { type: 'tool', name: VERIFY_TOOL.name },
                  messages: convo,
                },
                { timeout: 25_000, maxRetries: 0 }
              );
              modelCalls++;
              addUsage(vres.usage as ApiUsage);
              await recordApiCall({
                feature: FEATURE, model: MODEL, usage: vres.usage, wallMs: Date.now() - t,
                metadata: { round: 'verify', rounds, tool_calls: toolCalls },
              });
              const tu = vres.content.find(
                (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === VERIFY_TOOL.name
              );
              const parsedV = tu ? parseVerifyOutput(tu.input) : null;
              if (parsedV) report = { ...report, ...parsedV };
            } catch {
              // model leg unavailable; the deterministic report still ships
            }
          }
          emit(ndVerify(report));
        }

        // The reader-facing cost line: every model call this turn, priced on
        // the frozen rate card, web-search surcharge included.
        if (!req.signal.aborted) {
          const costUsd = await priceUsage(MODEL, totals);
          emit(ndCost({
            cost_usd: costUsd,
            input_tokens:
              (totals.input_tokens ?? 0) +
              (totals.cache_creation_input_tokens ?? 0) +
              (totals.cache_read_input_tokens ?? 0),
            output_tokens: totals.output_tokens ?? 0,
            cache_read_tokens: totals.cache_read_input_tokens ?? 0,
            searches: totals.server_tool_use.web_search_requests,
            rounds: modelCalls,
            model: MODEL,
          }));
        }

        if (!streamedAny && !req.signal.aborted) {
          emit(ndError('The research finished without an answer. Please try again.'));
        }
      } catch {
        emit(ndError(
          streamedAny
            ? 'The answer was cut short. The partial answer above stands on the records it cites.'
            : 'The research could not be completed. Please try again.'
        ));
      } finally {
        emit(ndDone(Object.fromEntries(tagger.refs().map((r) => [r.tag, r.id]))));
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

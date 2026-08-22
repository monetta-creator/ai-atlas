import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { q } from '@/lib/db';
import { priceUsage, recordApiCall, type ApiUsage } from '@/lib/cost';
import { loadNamespace } from '@/lib/ask/retrieve';
import { askSystem, deepConversationMessages } from '@/lib/ask/prompt';
import { clampHistory, clampSignalOffset, parseAskBody } from '@/lib/ask/history';
import { fetchRecord, searchArticles, searchAtlas } from '@/lib/ask/search';
import {
  DEEP_ADDENDUM, DEEP_TOOLS, INPUT_TOKEN_CAP, MAX_CALLS_PER_ROUND, MAX_ROUNDS,
  VERIFY_INSTRUCTION, VERIFY_TOOL, type VerifyReport,
  citeToken, createTagger, ndCost, ndDelta, ndDone, ndError, ndStatus, ndVerify,
  parseFetchRecordInput, parseSearchArticlesInput, parseSearchAtlasInput, parseSignalMap,
  parseVerifyOutput, renderArticleHits, renderRecord, renderSearchHits, runDeterministicChecks,
  STATUS_START, STATUS_VERIFYING, STATUS_WRITING, statusArticles, statusRead, statusRound, statusSearch,
} from '@/lib/ask/deep';

// "Ask the Atlas" research chat: an agentic tool-use loop over the Atlas
// (search_atlas / fetch_record / search_articles, all backed by lib/ask/search),
// followed by a forced streamed answer. This is the DEFAULT admin chat behind
// /ask; the quick route stays for the portal and the per-signal widget.
//
// The response is NDJSON (lib/ask/deep.ts): status lines while researching,
// delta lines for the answer, web_sources / verify / cost lines, and a
// terminal done line with the signal tag map.
//
// The loop guards itself on wall clock, rounds, calls, and context size so a
// slow session degrades to "answer with what you have", never a dead connection.
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
  const b = body as { signalOffset?: unknown; signalMap?: unknown };
  const tagger = createTagger(parseSignalMap(b?.signalMap), clampSignalOffset(b?.signalOffset));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  const client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });

  const ns = await loadNamespace();
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: `${askSystem()}\n\n${DEEP_ADDENDUM}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  const convo: Anthropic.MessageParam[] = deepConversationMessages(msgs, ns);
  const tools = DEEP_TOOLS as unknown as Anthropic.Tool[];

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
      // checks: the skeleton plus every successful tool result.
      const corpus: string[] = [ns.skeleton];
      // Rolling cache anchor: only the LATEST tool-result block carries a
      // breakpoint (plus system + skeleton), staying under the 4-block limit.
      let lastAnchor: Anthropic.ToolResultBlockParam | null = null;

      // Per-turn totals for the reader-facing cost report (priced once at the
      // end; pricing is linear so summed usage prices like per-call usage).
      const totals: ApiUsage = {
        input_tokens: 0, output_tokens: 0,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      };
      const addUsage = (u: ApiUsage | null | undefined) => {
        if (!u) return;
        totals.input_tokens = (totals.input_tokens ?? 0) + (u.input_tokens ?? 0);
        totals.output_tokens = (totals.output_tokens ?? 0) + (u.output_tokens ?? 0);
        totals.cache_creation_input_tokens =
          (totals.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        totals.cache_read_input_tokens =
          (totals.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
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

          const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
          if (!toolUses.length) {
            // The model answered without (more) research; its text is the answer.
            answerText = res.content
              .filter((c): c is Anthropic.TextBlock => c.type === 'text')
              .map((c) => c.text)
              .join('');
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

        // Verification, both layers. Layer 1 (quotes + figures vs the corpus)
        // is deterministic and always runs. Layer 2 rides the cached prefix
        // (the rolling anchor still sits on the last tool results) so the
        // cross-check costs a fraction of a cent; skipped near the deadline or
        // if it fails, in which case the deterministic results still ship.
        if (answerText.trim() && !req.signal.aborted) {
          let report: VerifyReport = { flags: [], ...runDeterministicChecks(answerText, corpus) };
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
        // the frozen rate card.
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
            searches: 0,
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

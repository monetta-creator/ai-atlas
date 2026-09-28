import Anthropic from '@anthropic-ai/sdk';
import { q } from '../db';
import { recordApiCall, type ApiUsage } from '../cost';
import { fetchRecord, searchArticles, searchAtlas } from '../ask/search';
import {
  DEEP_TOOLS, MAX_CALLS_PER_ROUND, citeToken, createTagger,
  parseFetchRecordInput, parseSearchArticlesInput, parseSearchAtlasInput,
  renderArticleHits, renderRecord, renderSearchHits,
} from '../ask/deep';
import { reportSectionHref } from '../embed/report-sections';
import type { FieldReportPlan, FieldReportSize, LedgerRecord, ResearchLogEntry, WebSource } from './core';

// Field Report's research, the enhanced deep research (docs/field-report.md).
// Two legs, each parked by the caller:
//   atlas: one research track per sub-question, the Ask tools only (search the
//          Atlas, read records, search the article corpus), adaptive thinking,
//          in parallel for Full; each track ends in a findings memo that cites
//          records by tag.
//   web:   one gap-fill pass with web_search, aimed at the plan's web gaps,
//          whatever the Atlas tracks found thin, and "what are we missing";
//          every result URL is captured as W1, W2... so the report can link
//          the web (Savant's lead loses them today). A second call writes the
//          web memo citing those ids.
// Claude 5 models take thinking as {type:'adaptive'} plus output_config.effort
// (measured 2026-09-28: 'enabled' with a budget is refused; adaptive works
// with client tools, web search and forced tools).

type Effort = 'low' | 'medium' | 'high';
export interface ResearchCtx {
  plan: FieldReportPlan;
  question: string;
  size: FieldReportSize;
  model: string;
  effort: Effort;
  webSearches: number;
  mode: 'admin' | 'portal';
  metadata: Record<string, unknown>;   // field_report_run, portal_key_id
  deadline: number;                    // epoch ms: stop researching past this
}

export interface TrackMemo { track: number; question: string; memo: string }
export interface AtlasLeg {
  tracks: TrackMemo[];
  tagRefs: { tag: string; id: string }[];
  seenCodes: string[];                 // "claim:3.1", "bridge:B5", "question:slug", ...
  log: ResearchLogEntry[];
  rounds: number;
  corpus: string;                      // tool result text, for the numbers check
}
export interface WebLeg { memo: string; sources: WebSource[]; log: ResearchLogEntry[]; searches: number }

const ROUNDS: Record<FieldReportSize, number> = { brief: 3, full: 5 };
const MAX_OUT = 16_000;

const isClaude5 = (model: string) => /^claude-(sonnet-5|opus-5|fable-5)/.test(model);
function thinkingParams(model: string, effort: Effort): Record<string, unknown> {
  // Adaptive thinking on the Claude 5 family; older ids run without it.
  return isClaude5(model) ? { thinking: { type: 'adaptive' }, output_config: { effort } } : {};
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey, timeout: 180_000, maxRetries: 1 });
}

const VOICE = `Write for a senior reader who has never heard of the Atlas's internals: never say claim, confidence, argument map, record id, tool, or a bare code like 3.1 in prose. Never use an em dash; use a comma, a colon, or separate sentences. Use only figures that appear in the material you read.`;

const TRACK_SYSTEM = `You are a research analyst for Field Report, the research-report desk of The AI Atlas: an intelligence system for the AI economy built on a map of the argument (open questions, stances, falsifiable claims and the evidence that moves them) plus signals, research papers, company intelligence, news history since 2022 and the Atlas's own editorial reports.

You are researching ONE track of a report. Research the Atlas thoroughly before concluding: search it several ways (different phrasings, the positions involved, the counter-case), read the records that matter with fetch_record, and search the article corpus for coverage. Prefer primary evidence and look for disagreement, not just support.

When you have what you need, stop calling tools and write your FINDINGS MEMO: 250 to 500 words of plain prose, the strongest findings first, what the evidence disagrees on, and what the Atlas does not hold (so the web pass can fill it). Cite every finding by putting the tag exactly as the tools showed it in square brackets right after the sentence it supports ([signal S3], [paper P2], [item I4], [fact X1], [report R5], [history H6], [claim 3.1], [bridge B5], [stance Q1-S1A], [question some-slug]). Never invent a tag. ${VOICE}`;

const WEB_SYSTEM = `You are the web researcher for Field Report, the research-report desk of The AI Atlas. The Atlas has already been researched; your job is to FILL ITS GAPS and SURFACE NEW CONSIDERATIONS from the live web: current figures, recent releases, regulators' latest statements, outside evidence that supports or contradicts what the Atlas holds, and anything important the plan did not anticipate. Search deliberately (specific queries, primary sources such as regulators, companies, research institutions and reputable outlets). Do not repeat what the Atlas already established. When you are done searching, stop and wait: you will be given the list of sources you found to write your memo from. ${VOICE}`;

export async function researchAtlas(ctx: ResearchCtx, onTrackDone?: (done: number, total: number) => void): Promise<AtlasLeg> {
  const c = client();
  const tagger = createTagger({}, 0);
  const log: ResearchLogEntry[] = [];
  const seen = new Set<string>();
  const corpusParts: string[] = [];
  let rounds = 0;

  const noteCodes = (text: string) => {
    for (const m of text.matchAll(/\[(claim|bridge|stance|question|concept|thread)\s+([A-Za-z0-9.\-]+)\]/g)) seen.add(`${m[1]}:${m[2]}`);
  };

  async function execTool(name: string, input: unknown, track: string, round: number): Promise<{ text: string; isError?: boolean }> {
    const admin = ctx.mode === 'admin';
    const portal = ctx.mode === 'portal';
    if (name === 'search_atlas') {
      const p = parseSearchAtlasInput(input);
      if (typeof p === 'string') return { text: p, isError: true };
      const hits = await searchAtlas(q, p.query, {
        kinds: p.kinds, limit: p.limit, admin, portal,
        tagFor: tagger.tagFor, paperTagFor: tagger.paperTagFor, itemTagFor: tagger.itemTagFor, factTagFor: tagger.factTagFor,
        reportTagFor: tagger.reportTagFor, historyTagFor: tagger.historyTagFor,
      });
      log.push({ track, tool: 'search_atlas', query: p.query, results: hits.length, round });
      return { text: renderSearchHits(hits) };
    }
    if (name === 'fetch_record') {
      const p = parseFetchRecordInput(input);
      if (typeof p === 'string') return { text: p, isError: true };
      let dbId = p.id;
      if (p.kind === 'signal' || p.kind === 'paper' || p.kind === 'item' || p.kind === 'fact') {
        const uuid = tagger.idFor(p.id);
        if (!uuid) return { text: `Unknown ${p.kind} tag ${p.id}. Use a tag from a result above.`, isError: true };
        dbId = uuid;
      } else if (p.kind === 'report') {
        const d = tagger.idFor(p.id);
        if (!d) return { text: `Unknown report tag ${p.id}. Use a tag from a result above.`, isError: true };
        const parts = d.split(':');
        dbId = parts.length === 5 ? `${parts[3]}:${parts[4]}` : d;
      } else if (p.kind === 'history') {
        const raw = tagger.idFor(p.id);
        if (!raw) return { text: `Unknown history tag ${p.id}. Use a tag from a result above.`, isError: true };
        dbId = raw.split('|')[0];
      }
      const payload = await fetchRecord(q, p.kind, dbId, { admin, portal });
      if (!payload) return { text: `No ${p.kind} found with id ${p.id}.`, isError: true };
      log.push({ track, tool: 'fetch_record', query: citeToken(p.kind, p.id), results: 1, round });
      return { text: renderRecord(payload, p.id, tagger.tagFor) };
    }
    if (name === 'search_articles') {
      const p = parseSearchArticlesInput(input);
      if (typeof p === 'string') return { text: p, isError: true };
      const hits = await searchArticles(q, p.query, { tagFor: tagger.tagFor });
      log.push({ track, tool: 'search_articles', query: p.query, results: hits.length, round });
      return { text: renderArticleHits(hits) };
    }
    return { text: `Unknown tool ${name}.`, isError: true };
  }

  const tools = DEEP_TOOLS as Anthropic.Tool[];
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: TRACK_SYSTEM, cache_control: { type: 'ephemeral' } }];
  const planBrief = [
    `THE REPORT'S OBJECTIVE: ${ctx.plan.objective}`,
    `THE PERSON'S QUESTION: ${ctx.question}`,
    ctx.plan.considerations.length ? `CONSIDERATIONS TO KEEP IN MIND: ${ctx.plan.considerations.join(' | ')}` : '',
    ctx.plan.atlas_focus.length ? `WHAT THE ATLAS LIKELY HOLDS: ${ctx.plan.atlas_focus.join(' | ')}` : '',
    ctx.plan.out_of_scope.length ? `OUT OF SCOPE: ${ctx.plan.out_of_scope.join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  async function runTrack(i: number): Promise<TrackMemo> {
    const question = ctx.plan.sub_questions[i];
    const track = `T${i + 1}`;
    const convo: Anthropic.MessageParam[] = [{
      role: 'user',
      content: `${planBrief}\n\nYOUR TRACK (${track}): ${question}\n\nResearch this track in the Atlas, then write the findings memo.`,
    }];
    let memo = '';
    for (let round = 1; round <= ROUNDS[ctx.size]; round++) {
      if (Date.now() > ctx.deadline) break;
      const t = Date.now();
      const res = await c.messages.create({
        model: ctx.model, max_tokens: MAX_OUT, system, tools, messages: convo, ...thinkingParams(ctx.model, ctx.effort),
      } as Anthropic.MessageCreateParamsNonStreaming);
      rounds++;
      await recordApiCall({ feature: 'field_report_research', model: ctx.model, usage: res.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...ctx.metadata, track, round, leg: 'atlas' } });
      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      convo.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
      if (!toolUses.length) {
        memo = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
        break;
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses.slice(0, MAX_CALLS_PER_ROUND)) {
        const r = await execTool(tu.name, tu.input, track, round);
        if (!r.isError) { corpusParts.push(r.text); noteCodes(r.text); }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
      }
      for (const tu of toolUses.slice(MAX_CALLS_PER_ROUND)) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Call budget for this round reached; continue with what you have.', is_error: true });
      }
      convo.push({ role: 'user', content: results });
    }
    if (!memo) {
      // Out of rounds or time: ask for the memo with tools switched off.
      convo.push({ role: 'user', content: 'Research time is over for this track. Write the findings memo now from what you gathered, following every rule.' });
      const t = Date.now();
      const res = await c.messages.create({
        model: ctx.model, max_tokens: MAX_OUT, system, tools, tool_choice: { type: 'none' }, messages: convo, ...thinkingParams(ctx.model, ctx.effort),
      } as Anthropic.MessageCreateParamsNonStreaming);
      await recordApiCall({ feature: 'field_report_research', model: ctx.model, usage: res.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...ctx.metadata, track, leg: 'atlas_memo' } });
      memo = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    return { track: i + 1, question, memo };
  }

  const n = ctx.plan.sub_questions.length;
  const tracks: TrackMemo[] = new Array(n);
  let done = 0;
  const concurrency = ctx.size === 'full' ? 3 : 2;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, async () => {
    while (next < n) {
      const i = next++;
      tracks[i] = await runTrack(i);
      done++;
      onTrackDone?.(done, n);
    }
  }));
  return { tracks, tagRefs: tagger.refs(), seenCodes: [...seen], log, rounds, corpus: corpusParts.join('\n').slice(0, 400_000) };
}

// ---- the web leg -------------------------------------------------------------------------
interface WebResultBlock { type: 'web_search_tool_result'; content?: { type?: string; url?: string; title?: string; page_age?: string | null }[] | { type: string } }
interface ServerToolUseBlock { type: 'server_tool_use'; name?: string; input?: { query?: string } }

export async function researchWeb(ctx: ResearchCtx, atlas: AtlasLeg): Promise<WebLeg> {
  const c = client();
  const log: ResearchLogEntry[] = [];
  const sources: WebSource[] = [];
  const byUrl = new Map<string, string>();
  if (ctx.webSearches <= 0) return { memo: '', sources, log, searches: 0 };

  const atlasBrief = atlas.tracks.map((t) => `TRACK ${t.track}: ${t.question}\n${t.memo.slice(0, 1800)}`).join('\n\n');
  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: WEB_SYSTEM, cache_control: { type: 'ephemeral' } }];
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: ctx.webSearches }] as unknown as Anthropic.Tool[];
  const convo: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [
      `THE REPORT'S OBJECTIVE: ${ctx.plan.objective}`,
      ctx.plan.web_gaps.length ? `THE PLAN'S WEB GAPS: ${ctx.plan.web_gaps.join(' | ')}` : '',
      ctx.plan.considerations.length ? `CONSIDERATIONS: ${ctx.plan.considerations.join(' | ')}` : '',
      `WHAT THE ATLAS RESEARCH FOUND (fill its gaps, do not repeat it):\n${atlasBrief}`,
      `Search the web now (up to ${ctx.webSearches} searches). When you have searched enough, stop.`,
    ].filter(Boolean).join('\n\n'),
  }];
  let searches = 0;
  for (let round = 1; round <= 4; round++) {
    if (Date.now() > ctx.deadline) break;
    const t = Date.now();
    const res = await c.messages.create({
      model: ctx.model, max_tokens: MAX_OUT, system, tools, messages: convo, ...thinkingParams(ctx.model, ctx.effort),
    } as Anthropic.MessageCreateParamsNonStreaming);
    const usage = res.usage as ApiUsage;
    searches += usage?.server_tool_use?.web_search_requests ?? 0;
    await recordApiCall({ feature: 'field_report_web', model: ctx.model, usage, wallMs: Date.now() - t, metadata: { ...ctx.metadata, round, leg: 'web' } });
    for (const b of res.content as unknown as (WebResultBlock | ServerToolUseBlock | { type: string })[]) {
      if (b.type === 'server_tool_use') {
        const qy = (b as ServerToolUseBlock).input?.query;
        if (qy) log.push({ track: 'web', tool: 'web_search', query: qy, results: 0, round });
      }
      if (b.type === 'web_search_tool_result') {
        const content = (b as WebResultBlock).content;
        const list = Array.isArray(content) ? content : [];
        if (log.length) log[log.length - 1].results = list.length;
        for (const r of list) {
          if (!r.url || byUrl.has(r.url)) continue;
          const id = `W${sources.length + 1}`;
          byUrl.set(r.url, id);
          sources.push({ id, url: r.url, title: (r.title ?? r.url).slice(0, 200), date: r.page_age ?? null });
        }
      }
    }
    convo.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
    if ((res as { stop_reason?: string }).stop_reason === 'pause_turn') continue;
    break;
  }
  if (!sources.length) return { memo: '', sources, log, searches };

  // The memo, citing the web by the ids this run minted.
  convo.push({
    role: 'user',
    content: `Here are the web sources you found, with ids to cite:\n${sources.map((s) => `[${s.id}] ${s.title} (${s.url})${s.date ? `, ${s.date}` : ''}`).join('\n')}\n\n` +
      `Write the WEB MEMO now: 250 to 500 words. First what the web adds to each track (label each paragraph with its track number), then a paragraph headed "New considerations" for anything important the plan did not anticipate. Cite every web finding with its id in square brackets right after the sentence, like [W3]. Name the outlet or institution in prose too. Never cite an id not in the list.`,
  });
  const t = Date.now();
  const fin = await c.messages.create({
    model: ctx.model, max_tokens: MAX_OUT, system, tools, tool_choice: { type: 'none' }, messages: convo, ...thinkingParams(ctx.model, ctx.effort),
  } as Anthropic.MessageCreateParamsNonStreaming);
  await recordApiCall({ feature: 'field_report_web', model: ctx.model, usage: fin.usage as ApiUsage, wallMs: Date.now() - t, metadata: { ...ctx.metadata, leg: 'web_memo' } });
  const memo = fin.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { memo, sources, log, searches };
}

// ---- links ----------------------------------------------------------------------------------
// Tag -> href for every record the tracks saw: S -> /signals, P -> /research,
// I -> the item's url, X -> the fact's item url, R -> the report section,
// H -> the article url. Codes only when a tool result showed them.
export async function resolveLinks(atlas: AtlasLeg): Promise<{ tagHrefs: Map<string, string>; codeHrefs: Map<string, string>; records: LedgerRecord[] }> {
  const tagHrefs = new Map<string, string>();
  const records: LedgerRecord[] = [];
  const itemIds: string[] = [];
  const factIds: string[] = [];
  for (const r of atlas.tagRefs) {
    const p = r.tag[0];
    if (p === 'S') tagHrefs.set(r.tag, `/signals/${r.id}`);
    else if (p === 'P') tagHrefs.set(r.tag, `/research/${r.id}`);
    else if (p === 'H') { const url = r.id.split('|')[1]; if (url) tagHrefs.set(r.tag, url); }
    else if (p === 'R') {
      const parts = r.id.split(':'); // report:<kind>:<scope>:<uuid>:<section>
      if (parts.length === 5) tagHrefs.set(r.tag, reportSectionHref(parts[1], parts[3], parts[2] || null, parts[4]));
    } else if (p === 'I') itemIds.push(r.id.replace(/^(scan|intel):/, ''));
    else if (p === 'X') factIds.push(r.id);
  }
  if (itemIds.length) {
    const rows = await q<{ id: string; url: string }>(
      `select id::text as id, url from scan_items where id::text = any($1) union all select id::text as id, url from intel_items where id::text = any($1)`, [itemIds]);
    const byId = new Map(rows.map((r) => [r.id, r.url]));
    for (const r of atlas.tagRefs) if (r.tag.startsWith('I')) { const u = byId.get(r.id.replace(/^(scan|intel):/, '')); if (u) tagHrefs.set(r.tag, u); }
  }
  if (factIds.length) {
    const rows = await q<{ id: string; url: string | null }>(
      `select f.id::text as id, ii.url from intel_facts f left join intel_items ii on ii.id = f.item_id where f.id::text = any($1)`, [factIds]);
    const byId = new Map(rows.map((r) => [r.id, r.url]));
    for (const r of atlas.tagRefs) if (r.tag.startsWith('X')) { const u = byId.get(r.id); if (u) tagHrefs.set(r.tag, u); }
  }
  const kindOf: Record<string, string> = { S: 'signal', P: 'paper', I: 'item', X: 'fact', R: 'report', H: 'history' };
  for (const r of atlas.tagRefs) {
    const href = tagHrefs.get(r.tag);
    if (href) records.push({ tag: r.tag, kind: kindOf[r.tag[0]] ?? 'record', href, title: r.tag });
  }
  const codeHrefs = new Map<string, string>();
  const codePath: Record<string, (id: string) => string | null> = {
    claim: (id) => `/claim/${id}`, bridge: (id) => `/bridge/${id}`, question: (id) => `/q/${id}`,
    concept: (id) => `/concepts/${id}`, thread: (id) => `/research/threads/${id}`, stance: () => null,
  };
  for (const key of atlas.seenCodes) {
    const [kind, id] = key.split(':');
    const href = codePath[kind]?.(id) ?? null;
    if (href) { codeHrefs.set(key, href); records.push({ tag: key, kind, href, title: key }); }
  }
  await titleRecords(records, atlas.tagRefs);
  return { tagHrefs, codeHrefs, records };
}

// Gives each ledger record its own title (Appendix B and the figure catalog
// read it); a record the lookup misses keeps its tag and the appendix falls
// back to a generic label.
export async function titleRecords(records: LedgerRecord[], tagRefs: { tag: string; id: string }[]): Promise<void> {
  const idOf = new Map(tagRefs.map((r) => [r.tag, r.id.replace(/^(scan|intel):/, '')] as const));
  const want = (kind: string) => records.filter((r) => r.kind === kind);
  const ids = (kind: string, byTag: boolean) => want(kind).map((r) => (byTag ? idOf.get(r.tag) : r.tag.split(':')[1]) ?? '').filter(Boolean);
  const lookups: [string, boolean, string][] = [
    ['signal', true, `select id::text k, title t from signals where id::text = any($1)`],
    ['paper', true, `select id::text k, title t from papers where id::text = any($1)`],
    ['item', true, `select id::text k, headline t from scan_items where id::text = any($1) union all select id::text, headline from intel_items where id::text = any($1)`],
    ['fact', true, `select id::text k, fact t from intel_facts where id::text = any($1)`],
    ['claim', false, `select code k, statement t from claims where code = any($1)`],
    ['bridge', false, `select code k, statement t from bridge_claims where code = any($1)`],
    ['question', false, `select slug k, title t from questions where slug = any($1)`],
    ['concept', false, `select slug k, name t from concepts where slug = any($1)`],
    ['thread', false, `select slug k, title t from research_threads where slug = any($1)`],
  ];
  await Promise.all(lookups.map(async ([kind, byTag, sql]) => {
    const list = ids(kind, byTag);
    if (!list.length) return;
    const rows = await q<{ k: string; t: string | null }>(sql, [list]).catch(() => []);
    const title = new Map(rows.map((r) => [r.k, r.t] as const));
    for (const r of want(kind)) {
      const t = title.get((byTag ? idOf.get(r.tag) : r.tag.split(':')[1]) ?? '');
      if (t) r.title = t.replace(/\s+/g, ' ').trim().slice(0, 140);
    }
  }));
}

import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { q } from '../db';
import { recordApiCall, type ApiUsage } from '../cost';
import { fetchRecord, searchArticles, searchAtlas } from '../ask/search';
import {
  DEEP_TOOLS, INPUT_TOKEN_CAP, MAX_CALLS_PER_ROUND, citeToken, createTagger,
  parseFetchRecordInput, parseSearchArticlesInput, parseSearchAtlasInput,
  renderArticleHits, renderRecord, renderSearchHits,
} from '../ask/deep';
import { selfRecordBlock } from './self-record-block';
import type { SavantPack, QueryLogEntry, PlanPayload } from './types';

// Savant's lead research (2026-09-26): a bounded tool-use loop over the same
// Atlas tools the /ask research chat uses (search_atlas, fetch_record,
// search_articles from lib/ask/search, in PORTAL mode so every payload is
// key-safe), plus the web_search server tool capped at 3 uses, followed by a
// forced final that writes the lead analysis. Self-contained rather than a
// refactor of app/api/ask/deep/route.ts: that loop is wound around a
// streaming NDJSON response with lanes and a verifier; this one needs none of
// that and must not destabilize /ask. Records are cited by tag ([S3], [P1],
// [I4], [X2]) and resolved to hrefs afterwards, so the citation gate sees
// real links; positions are linked by exact href.

const MAX_ROUNDS = 4;

const LEAD_SYSTEM =
  `You are Savant, the research desk of The AI Atlas: an autonomous analyst writing the lead analysis of a ` +
  `weekly report for people doing AI transformation inside large regulated financial-services companies, ` +
  `read by their executives. You have a research plan, a hypothesis to test, and a week's notebook of ` +
  `connections and anomalies the desk recorded. Research with the tools first: search the Atlas, read the ` +
  `records that matter, search the article corpus; use web_search only when a current development or an ` +
  `outside figure would sharpen the analysis, at most three times. Then write. Rules for the writing: ` +
  `argue as a columnist, with a point of view, for a reader who has never heard of the Atlas and does not ` +
  `need to; cite records by putting their tag in square brackets right after the sentence they support, ` +
  `exactly as the tools showed it ([signal S3], [paper P2], [item I4], [fact X1], [claim 3.1], [bridge B5], ` +
  `[stance Q1-S1A]); the application turns each into a numbered footnote link, so never spell a tag out in ` +
  `words and never write a tag inside a sentence's grammar. Link a standing position by wrapping a natural ` +
  `phrase in a markdown link to its EXACT href as shown in the results (for example [training data is ` +
  `becoming a balance-sheet cost](/claim/3.6)); in prose never write the words claim, confidence, argument ` +
  `map, logic tree, or a bare position or stance code such as 3.1, B5, S1B; ` +
  `never state anything about the reader organization that is not in a cited public record; use only ` +
  `figures that appear in the records or in a web result you name by outlet; never use an em dash, use a ` +
  `comma, a colon, or separate sentences.`;

const LEAD_FINAL_TOOL: Anthropic.Tool = {
  name: 'submit_lead',
  description: 'Return the finished lead analysis.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'an editorial title, at most 12 words, plain text' },
      body_md: { type: 'string', description: 'GitHub-flavored markdown, 1500 to 2500 words, bold lead-ins instead of headings, tags in square brackets after sentences, position links by exact href, a closing section that starts with the bold words "What we will watch"' },
      hypothesis_reading: { type: 'string', description: 'strengthened | weakened | unchanged' },
      reading_note: { type: 'string', description: 'two sentences: what this week did to the hypothesis and what would settle it, with tags' },
    },
    required: ['title', 'body_md', 'hypothesis_reading', 'reading_note'],
  },
};

export interface LeadResult {
  title: string;
  markdown: string;
  html: string;                 // tags resolved to links, markdown rendered; NOT yet citation-gated
  reading: 'strengthened' | 'weakened' | 'unchanged';
  readingNote: string;          // tags resolved to markdown links
  readingHtml: string;
  queries: QueryLogEntry[];
  rounds: number;
  webSearches: number;
  tagHrefs: Map<string, string>; // tag -> href, for the allow-list
}

function planBrief(plan: PlanPayload | null, pack: SavantPack): string {
  if (!plan) return 'No plan was recorded this week. Choose the strongest thread in the notebook and treat it as the topic.';
  return [
    `TOPIC: ${plan.topic}`,
    `QUESTION: ${plan.question_slug}`,
    `WHY: ${plan.why}`,
    `HYPOTHESIS TO TEST: ${plan.hypothesis.statement}`,
    `WHAT WOULD SETTLE IT: ${plan.hypothesis.what_would_settle_it.join('; ')}`,
    `WATCH: ${plan.hypothesis.watch.join('; ')}`,
    pack.self ? `READER ORGANIZATION (public description only): ${pack.self.name}. ${pack.self.public_blurb ?? ''}`.trim() : '',
    pack.self ? selfRecordBlock(pack.self) : '',
  ].filter(Boolean).join('\n');
}

function notebookBrief(pack: SavantPack): string {
  const lines: string[] = [];
  for (const c of pack.notebook.connections.slice(0, 20)) lines.push(`- ${c.record.title} ~ ${c.target.code}: ${c.target.statement} (${c.target.href})`);
  for (const a of pack.notebook.anomalies.slice(0, 12)) lines.push(`- ${a.note}`);
  for (const n of pack.notebook.notes) lines.push(`- diary ${n.day}: ${n.text}`);
  return lines.length ? lines.join('\n') : '- (empty notebook)';
}

// Resolve the loop's tags to hrefs: S -> /signals/<id>, P -> /research/<id>,
// I -> the item's external url, X -> the fact's item url.
async function resolveTagHrefs(refs: { tag: string; id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const by = (prefix: string) => refs.filter((r) => r.tag.startsWith(prefix)).map((r) => r.id);
  for (const r of refs) {
    if (r.tag.startsWith('S')) out.set(r.tag, `/signals/${r.id}`);
    if (r.tag.startsWith('P')) out.set(r.tag, `/research/${r.id}`);
  }
  const itemIds = by('I');
  if (itemIds.length) {
    const rows = await q<{ id: string; url: string }>(
      `select id::text as id, url from scan_items where id::text = any($1)
       union all select id::text as id, url from intel_items where id::text = any($1)`, [itemIds]);
    const byId = new Map(rows.map((r) => [r.id, r.url]));
    for (const r of refs) if (r.tag.startsWith('I') && byId.get(r.id)) out.set(r.tag, byId.get(r.id)!);
  }
  const factIds = by('X');
  if (factIds.length) {
    const rows = await q<{ id: string; url: string | null }>(
      `select f.id::text as id, ii.url from intel_facts f left join intel_items ii on ii.id = f.item_id where f.id::text = any($1)`, [factIds]);
    for (const r of rows) if (r.url) for (const ref of refs) if (ref.tag.startsWith('X') && ref.id === r.id) out.set(ref.tag, r.url);
  }
  return out;
}

// The tools render records as "[signal S3]", "[paper P2]", "[item I4]",
// "[fact X1]", "[claim 3.1]", "[bridge B5]", "[stance Q1-S1A]" (citeToken),
// and the model also writes the short "[S3]". Every form becomes a numbered
// footnote link, one number per distinct href in order of first use, so the
// prose reads like a research note and the citation gate sees real links. A
// token with no href is dropped (the gate would strip an invented link).
export function linkifyCitations(md: string, tagHrefs: Map<string, string>, codeHrefs: Map<string, string>): { md: string; used: Map<string, number> } {
  const used = new Map<string, number>();
  const num = (href: string) => { if (!used.has(href)) used.set(href, used.size + 1); return used.get(href)!; };
  const out = md.replace(/\[(?:(signal|paper|item|fact)\s+)?([SPIX]\d{1,3})\]|\[(claim|bridge|stance|Q)\s+([A-Za-z0-9.\-]+)\]|\[(Q\d-S\d[A-C]|B\d{1,2}|\d\.\d{1,2})\]/g, (_m, _k1: string | undefined, tag: string | undefined, kind: string | undefined, code: string | undefined, bare: string | undefined) => {
    let href: string | undefined;
    if (tag) href = tagHrefs.get(tag);
    else if (kind && code) href = codeHrefs.get(`${kind === 'Q' ? 'question' : kind}:${code}`);
    else if (bare) href = codeHrefs.get(`${bare.startsWith('Q') ? 'stance' : bare.startsWith('B') ? 'bridge' : 'claim'}:${bare}`);
    return href ? `[${num(href)}](${href})` : '';
  }).replace(/\s+([.,;:])/g, '$1').replace(/\)\s*\[(\d+)\]\(/g, ') [$1](');
  return { md: out, used };
}

const deDash = (s: string) => s.replace(/\s*—\s*/g, ', ');

export async function researchLead(pack: SavantPack, opts: { model: string; deadlineMs: number; weekEnd: string }): Promise<LeadResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  const tagger = createTagger({}, 0);
  const queries: QueryLogEntry[] = [];
  let webSearches = 0;
  const t0 = Date.now();
  const deadline = t0 + opts.deadlineMs;

  const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: LEAD_SYSTEM, cache_control: { type: 'ephemeral' } }];
  const tools = [...DEEP_TOOLS, { type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] as unknown as Anthropic.Tool[];
  const convo: Anthropic.MessageParam[] = [{
    role: 'user',
    content:
      `WEEK ENDING ${opts.weekEnd}. Research the plan below, then write the lead analysis.\n\n${planBrief(pack.plan, pack)}\n\n` +
      `THE WEEK'S NOTEBOOK (connections, anomalies, diary):\n${notebookBrief(pack)}\n\n` +
      `Start with search_atlas on the topic and on the hypothesis; read the two or three records that matter most with fetch_record; ` +
      `search_articles for the week's coverage; use web_search at most three times, only for a current figure or development the records lack.`,
  }];

  let rounds = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  const addUsage = (u: ApiUsage | null | undefined) => { inputTokens += (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0); };

  async function execTool(name: string, input: unknown, round: number): Promise<{ text: string; isError?: boolean }> {
    if (name === 'search_atlas') {
      const p = parseSearchAtlasInput(input);
      if (typeof p === 'string') return { text: p, isError: true };
      const hits = await searchAtlas(q, p.query, {
        kinds: p.kinds, limit: p.limit, admin: false, portal: true,
        tagFor: tagger.tagFor, paperTagFor: tagger.paperTagFor, itemTagFor: tagger.itemTagFor, factTagFor: tagger.factTagFor,
      });
      queries.push({ tool: 'search_atlas', query: p.query, results: hits.length, round });
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
      }
      const payload = await fetchRecord(q, p.kind, dbId, { admin: false, portal: true });
      if (!payload) return { text: `No ${p.kind} found with id ${p.id}.`, isError: true };
      queries.push({ tool: 'fetch_record', query: citeToken(p.kind, p.id), results: 1, round });
      return { text: renderRecord(payload, p.id, tagger.tagFor) };
    }
    if (name === 'search_articles') {
      const p = parseSearchArticlesInput(input);
      if (typeof p === 'string') return { text: p, isError: true };
      const hits = await searchArticles(q, p.query, { tagFor: tagger.tagFor });
      queries.push({ tool: 'search_articles', query: p.query, results: hits.length, round });
      return { text: renderArticleHits(hits) };
    }
    return { text: `Unknown tool ${name}.`, isError: true };
  }

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (Date.now() > deadline - 60_000 || inputTokens > INPUT_TOKEN_CAP) break;
    const t = Date.now();
    const res = await client.messages.create({ model: opts.model, max_tokens: 1400, system, tools, messages: convo });
    rounds = round;
    addUsage(res.usage as ApiUsage);
    const web = (res.usage as ApiUsage)?.server_tool_use?.web_search_requests;
    if (typeof web === 'number') webSearches += web;
    await recordApiCall({ feature: 'savant_lead', model: opts.model, usage: res.usage, wallMs: Date.now() - t, metadata: { week_end: opts.weekEnd, round, leg: 'research' } });

    const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const paused = (res as { stop_reason?: string | null }).stop_reason === 'pause_turn';
    if (!toolUses.length) {
      if (paused && round < MAX_ROUNDS) {
        convo.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
        continue;
      }
      break; // the model stopped researching on its own
    }
    convo.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses.slice(0, MAX_CALLS_PER_ROUND)) {
      toolCalls++;
      const r = await execTool(tu.name, tu.input, round);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text, ...(r.isError ? { is_error: true } : {}) });
    }
    for (const tu of toolUses.slice(MAX_CALLS_PER_ROUND)) {
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Call budget for this round reached; continue with what you have.', is_error: true });
    }
    convo.push({ role: 'user', content: results });
  }

  // The forced final.
  convo.push({
    role: 'user',
    content: 'Research is over. Write the lead analysis now with submit_lead, from the records gathered above and the notebook, following every writing rule. 1500 to 2500 words.',
  });
  const t = Date.now();
  const fin = await client.messages.create({
    model: opts.model, max_tokens: 9000, system, tools: [LEAD_FINAL_TOOL], tool_choice: { type: 'tool', name: 'submit_lead' }, messages: convo,
  });
  await recordApiCall({ feature: 'savant_lead', model: opts.model, usage: fin.usage, wallMs: Date.now() - t, metadata: { week_end: opts.weekEnd, leg: 'final', rounds, toolCalls } });
  const use = fin.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  const out = (use?.input ?? {}) as { title?: string; body_md?: string; hypothesis_reading?: string; reading_note?: string };
  const tagHrefs = await resolveTagHrefs(tagger.refs());
  const codeHrefs = new Map<string, string>();
  for (const m of pack.mapHrefs) {
    const kind = m.href.startsWith('/claim/') ? 'claim' : m.href.startsWith('/bridge/') ? 'bridge' : m.href.startsWith('/q/') ? 'stance' : null;
    if (kind) codeHrefs.set(`${kind}:${m.code}`, m.href);
  }
  const md = deDash(linkifyCitations(String(out.body_md ?? ''), tagHrefs, codeHrefs).md).trim();
  const noteMd = deDash(linkifyCitations(String(out.reading_note ?? ''), tagHrefs, codeHrefs).md).trim();
  for (const [, href] of codeHrefs) tagHrefs.set(`code:${href}`, href);
  const readingRaw = String(out.hypothesis_reading ?? 'unchanged').toLowerCase();
  const reading = readingRaw.includes('strength') ? 'strengthened' : readingRaw.includes('weak') ? 'weakened' : 'unchanged';
  return {
    title: deDash(String(out.title ?? 'This week')).trim().slice(0, 140),
    markdown: md,
    html: marked.parse(md, { async: false }) as string,
    reading,
    readingNote: noteMd,
    readingHtml: marked.parse(noteMd, { async: false }) as string,
    queries,
    rounds,
    webSearches,
    tagHrefs,
  };
}

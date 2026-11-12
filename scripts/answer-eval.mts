// Answer-quality eval runner (Phase 0 of the one-box redo).
//
// Usage: npx -y tsx scripts/answer-eval.mts <cmd> [flags]
//   validate [--items path] [--no-min]
//   run    --arm current|bare|harness [--items path] [--limit N] [--ids a,b] [--date YYYY-MM-DD]
//   judge  --arm X [--date YYYY-MM-DD] [--items path]
//   report [--date YYYY-MM-DD]
//
// Items, rubric, and runs live in the gitignored private/answer-gold/. Every
// model call here logs through recordApiCall (features answer_eval_bare and
// answer_eval_judge); the `current` arm hits the local deep Ask route, which
// logs its own ask_deep cost. Before every item the spend guard sums
// ai_cost_log since BUILD_START_EPOCH for answer_eval% and ask_% features and
// stops at EVAL_SPEND_CAP_USD. The DB is only read here (plus recordApiCall's
// inserts, and lib/ask/search.ts fetchRecord selects for tag titles).

import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const GOLD = path.join(REPO, 'private/answer-gold');
const DEFAULT_ITEMS = path.join(GOLD, 'items.json');
const RUBRIC_PATH = path.join(GOLD, 'rubric.md');
const RUNS_DIR = path.join(GOLD, 'runs');
const EPOCH_PATH = path.join(REPO, 'private/redo/build/BUILD_START_EPOCH');
const COOKIE_PATH = path.join(REPO, 'private/redo/build/admin-cookie.txt');
const ASK_URL = process.env.EVAL_ASK_URL || 'http://localhost:3100/api/ask/deep';

export const EVAL_SPEND_CAP_USD = Number(process.env.EVAL_SPEND_CAP_USD) || 15; // raised per session with the env var (2026-11-12: 25, the agreed iteration budget)
export const BARE_MODEL = 'claude-haiku-5-5';
export const JUDGE_MODEL = 'claude-sonnet-5-5';

export const WANTS = ['lookup', 'understand', 'learn', 'work', 'think'] as const;
export const PROBES = ['corpus-only', 'false-premise', 'agreeable-trap', 'vague-intent', 'teach-me'] as const;
export const CRITERIA = ['cited', 'correct', 'current', 'pushed_back', 'read_intent', 'taught', 'did_work'] as const;
export type Criterion = (typeof CRITERIA)[number];
const MIN_PER_PROBE = 6;

// ---------------------------------------------------------------- types
export interface Item {
  id: string;
  prompt: string;
  wants: string[];
  probes: string[];
  great_answer: string[];
  trap: string;
  needs_web: boolean;
  expected_records?: string[];
}

export interface ResolvedTag { tag: string; kind: string; id: string; title: string | null }
export interface WebSource { url: string; title?: string | null }

export interface ArmResult {
  answer: string;
  tags: string[];
  resolved_tags: ResolvedTag[];
  web_sources: WebSource[];
  cost_usd: number | null;
  wall_ms: number;
  [extra: string]: unknown;
}

export type Arm = (item: Item) => Promise<ArmResult>;

export interface CriterionScore { score: 0 | 1 | 2 | null; note: string }
export interface Judgment {
  scores: Record<Criterion, CriterionScore>;
  overall: string;
  flattery: boolean;
  em_dash: boolean;
  // Scored but kept OUT of item_score (added 2026-11-12) so new runs stay
  // comparable with the base runs: did the answer pick the right form.
  shape?: CriterionScore;
}

// ---------------------------------------------------------------- args
export function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | true> } {
  const [cmd = '', ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return { cmd, flags };
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- items
export function validateItems(raw: unknown, opts: { noMin?: boolean } = {}): {
  errors: string[]; items: Item[]; probeCounts: Record<string, number>; wantsCounts: Record<string, number>;
} {
  const errors: string[] = [];
  const items: Item[] = [];
  const probeCounts: Record<string, number> = Object.fromEntries(PROBES.map((p) => [p, 0]));
  const wantsCounts: Record<string, number> = Object.fromEntries(WANTS.map((w) => [w, 0]));
  if (!Array.isArray(raw)) return { errors: ['items file must be a JSON array'], items, probeCounts, wantsCounts };
  const seen = new Set<string>();
  const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
  raw.forEach((r, i) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const tag = `item[${i}]${typeof o.id === 'string' ? ` (${o.id})` : ''}`;
    let ok = true;
    const bad = (m: string) => { errors.push(`${tag}: ${m}`); ok = false; };
    if (typeof o.id !== 'string' || !o.id.trim()) bad('id must be a non-empty string');
    else if (seen.has(o.id)) bad('duplicate id');
    else seen.add(o.id);
    if (typeof o.prompt !== 'string' || !o.prompt.trim()) bad('prompt must be a non-empty string');
    if (!isStrArr(o.wants) || o.wants.length === 0) bad('wants must be a non-empty string array');
    else for (const w of o.wants) if (!(WANTS as readonly string[]).includes(w)) bad(`unknown wants value "${w}"`);
    if (!isStrArr(o.probes)) bad('probes must be a string array (may be empty)');
    else for (const p of o.probes) if (!(PROBES as readonly string[]).includes(p)) bad(`unknown probe "${p}"`);
    if (!isStrArr(o.great_answer) || o.great_answer.length < 3 || o.great_answer.length > 6) bad('great_answer must be 3-6 strings');
    if (typeof o.trap !== 'string') bad('trap must be a string');
    if (typeof o.needs_web !== 'boolean') bad('needs_web must be a boolean');
    if (o.expected_records !== undefined && !isStrArr(o.expected_records)) bad('expected_records must be a string array');
    if (!ok) return;
    const it = o as unknown as Item;
    items.push(it);
    for (const p of it.probes) probeCounts[p]++;
    for (const w of it.wants) wantsCounts[w]++;
  });
  if (!opts.noMin) {
    for (const p of PROBES) {
      if (probeCounts[p] < MIN_PER_PROBE) errors.push(`probe "${p}" has ${probeCounts[p]} items, needs at least ${MIN_PER_PROBE}`);
    }
  }
  return { errors, items, probeCounts, wantsCounts };
}

function loadItems(file: string): Item[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const v = validateItems(raw, { noMin: true });
  if (v.errors.length) throw new Error(`Items invalid:\n  ${v.errors.join('\n  ')}`);
  return v.items;
}

// ---------------------------------------------------------------- jsonl + resume
export function readJsonl<T = Record<string, unknown>>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l) as T]; } catch { return []; }
  });
}

export function doneIds(rows: { id?: unknown }[]): Set<string> {
  return new Set(rows.flatMap((r) => (typeof r.id === 'string' ? [r.id] : [])));
}

export function pendingItems(items: Item[], done: Set<string>, opts: { ids?: string[]; limit?: number } = {}): Item[] {
  let out = items;
  if (opts.ids?.length) out = out.filter((i) => opts.ids!.includes(i.id));
  if (opts.limit !== undefined && Number.isFinite(opts.limit)) out = out.slice(0, opts.limit);
  // --limit counts the selected slice, so resuming a --limit run does not walk past it.
  return out.filter((i) => !done.has(i.id));
}

const runFile = (date: string, arm: string) => path.join(RUNS_DIR, `${date}-${arm}.jsonl`);
const judgedFile = (date: string, arm: string) => path.join(RUNS_DIR, `${date}-${arm}.judged.jsonl`);
const appendLine = (file: string, o: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(o)}\n`);
};

// ---------------------------------------------------------------- NDJSON
export interface NdState { buf: string; events: Record<string, unknown>[] }
export function newNdState(): NdState { return { buf: '', events: [] }; }
// Feed one decoded chunk; complete lines become events, a trailing partial line waits for the next chunk.
export function ndFeed(s: NdState, chunk: string): void {
  s.buf += chunk;
  let i: number;
  while ((i = s.buf.indexOf('\n')) >= 0) {
    const line = s.buf.slice(0, i).trim();
    s.buf = s.buf.slice(i + 1);
    if (!line) continue;
    try { s.events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip malformed line */ }
  }
}
export function ndEnd(s: NdState): void { ndFeed(s, '\n'); }

export interface DeepSummary {
  answer: string; lane: string | null; laneReason: string | null; decline: unknown; webSources: WebSource[];
  verify: unknown; cost: Record<string, unknown> | null; signals: Record<string, string>; statuses: string[]; error: string | null;
  // v2 only (lib/ask/v2-events.ts).
  decision?: unknown; toolCalls?: string[];
}
export function summarizeEvents(events: Record<string, unknown>[]): DeepSummary {
  const out: DeepSummary = {
    answer: '', lane: null, laneReason: null, decline: null, webSources: [], verify: null, cost: null,
    signals: {}, statuses: [], error: null, toolCalls: [],
  };
  for (const e of events) {
    switch (e.type) {
      case 'lane': out.lane = String(e.lane ?? ''); out.laneReason = e.reason == null ? null : String(e.reason); break;
      case 'status': out.statuses.push(String(e.text ?? '')); break;
      case 'delta': out.answer += String(e.text ?? ''); break;
      // v2: text so far was narration before a tool call.
      case 'retract': out.answer = ''; break;
      case 'decision': out.decision = e.decision ?? null; break;
      case 'tool_call': out.toolCalls!.push(String(e.name ?? '')); break;
      case 'sources':
      case 'web_sources': out.webSources = Array.isArray(e.sources) ? (e.sources as WebSource[]) : []; break;
      case 'verify': out.verify = e.report ?? null; break;
      case 'cost': out.cost = (e.report as Record<string, unknown>) ?? null; break;
      case 'done': out.signals = (e.signals as Record<string, string>) ?? {}; break;
      case 'error': out.error = String(e.text ?? ''); break;
      case 'decline': out.decline = e.payload ?? null; break;
    }
  }
  return out;
}

// Distinct record citations in first-seen order. The model cites "[claim 1.3]", "[signal S3]",
// "[Q slug]" (kind word + id, see lib/ask/prompt.ts); a bare "[S3]" is accepted too.
const CITE_KINDS = 'claim|bridge|stance|Q|concept|signal|paper|thread|item|fact|report|history';
export function extractTags(answer: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(`\\[(?:(${CITE_KINDS})\\s+([^\\]\\s,]{1,200})|([SPIXRH]\\d{1,4}))\\]`, 'g');
  for (const m of answer.matchAll(re)) {
    const tag = m[3] ?? `${m[1]} ${m[2]}`;
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

// ---------------------------------------------------------------- scoring
export function applicableCriteria(item: Pick<Item, 'wants' | 'probes'>): Set<Criterion> {
  const s = new Set<Criterion>(['cited', 'correct', 'current', 'read_intent']);
  if (item.wants.includes('learn') || item.wants.includes('understand') || item.probes.includes('teach-me')) s.add('taught');
  if (item.wants.includes('work')) s.add('did_work');
  if (item.probes.includes('false-premise') || item.probes.includes('agreeable-trap')) s.add('pushed_back');
  return s;
}

export function applyApplicability(
  scores: Partial<Record<Criterion, { score: number | null; note?: string }>>,
  item: Pick<Item, 'wants' | 'probes'>
): Record<Criterion, CriterionScore> {
  const ok = applicableCriteria(item);
  const out = {} as Record<Criterion, CriterionScore>;
  for (const c of CRITERIA) {
    const raw = scores[c];
    const v = raw?.score;
    const valid = v === 0 || v === 1 || v === 2;
    out[c] = { score: ok.has(c) && valid ? (v as 0 | 1 | 2) : null, note: String(raw?.note ?? '') };
  }
  return out;
}

export function itemScore(scores: Record<Criterion, CriterionScore>): number | null {
  const vals = CRITERIA.flatMap((c) => (scores[c].score === null ? [] : [scores[c].score as number]));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------------------------------------------------------------- lazy lib + DB
let libReady: Promise<{
  cost: typeof import('../lib/cost.ts');
  q: typeof import('../lib/db.ts').q;
  search: typeof import('../lib/ask/search.ts');
  verify: typeof import('../lib/ask/verify.ts');
}> | null = null;

function loadLib() {
  libReady ??= (async () => {
    config({ path: path.join(REPO, '.env.local') });
    const pw = process.env.SUPABASE_DB_PASSWORD;
    if (!process.env.DATABASE_URL) {
      if (!pw) throw new Error('SUPABASE_DB_PASSWORD not set (expected in .env.local).');
      // Same pooler routing as scripts/history-backfill.mts: the direct host is IPv6-only.
      process.env.DATABASE_URL = `postgresql://postgres.wuyxchwgasjefbswpxvm:${encodeURIComponent(pw)}@aws-1-us-east-2.pooler.supabase.com:6543/postgres`;
    }
    process.env.DB_POOL_MAX = '1';
    const [cost, db, search, verify] = await Promise.all([
      import('../lib/cost.ts'), import('../lib/db.ts'), import('../lib/ask/search.ts'), import('../lib/ask/verify.ts'),
    ]);
    return { cost, q: db.q, search, verify };
  })();
  return libReady;
}

export async function evalSpendUsd(): Promise<number> {
  config({ path: path.join(REPO, '.env.local') });
  const pg = (await import('pg')).default;
  const start = Number(readFileSync(EPOCH_PATH, 'utf8').trim());
  const c = new pg.Client({
    host: process.env.SUPABASE_DB_HOST, port: Number(process.env.SUPABASE_DB_PORT || 5432),
    user: process.env.SUPABASE_DB_USER, password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME || 'postgres', ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query('set default_transaction_read_only = on');
    const r = await c.query(
      `select coalesce(sum(cost_usd),0)::float as usd from ai_cost_log
        where created_at >= to_timestamp($1) and (feature like 'answer_eval%' or feature like 'ask_%')`,
      [start]
    );
    return Number(r.rows[0].usd);
  } finally {
    await c.end();
  }
}

class SpendCapError extends Error {}
async function guardSpend(): Promise<void> {
  const usd = await evalSpendUsd();
  if (usd >= EVAL_SPEND_CAP_USD) {
    throw new SpendCapError(`eval spend cap reached: $${usd.toFixed(2)} >= $${EVAL_SPEND_CAP_USD} since build start (answer_eval% + ask_% features). Stopping.`);
  }
}

// Citation -> {kind,id,title} through fetchRecord (the same function behind /api/ask/peek).
const PREFIX_KIND: Record<string, string> = { S: 'signal', P: 'paper', I: 'item', X: 'fact', R: 'report', H: 'history' };
const MAPPED_KINDS = new Set(['signal', 'paper', 'item', 'fact', 'report', 'history']);
export async function resolveTags(tags: string[], signals: Record<string, string>): Promise<ResolvedTag[]> {
  if (!tags.length) return [];
  const { q, search, verify } = await loadLib();
  const out: ResolvedTag[] = [];
  for (const tag of tags) {
    let kind: string;
    let key: string;
    const sp = tag.indexOf(' ');
    if (sp > 0) { kind = tag.slice(0, sp); key = tag.slice(sp + 1); } else { kind = PREFIX_KIND[tag[0]] ?? 'signal'; key = tag; }
    if (kind === 'Q') kind = 'question';
    let id = key;
    let title: string | null = null;
    try {
      if (MAPPED_KINDS.has(kind)) {
        const mapValue = signals[key.toUpperCase()];
        if (!mapValue) { out.push({ tag, kind, id: '', title: null }); continue; }
        id = verify.toPeekId(kind as Parameters<typeof verify.toPeekId>[0], mapValue);
      }
      const p = await search.fetchRecord(q, kind as Parameters<typeof search.fetchRecord>[1], id, { admin: true });
      title = p ? [p.title, p.published_on].filter(Boolean).join(' | ') : null;
    } catch { /* leave unresolved */ }
    out.push({ tag, kind, id, title });
  }
  return out;
}

// ---------------------------------------------------------------- arms
async function armCurrent(item: Item): Promise<ArmResult> {
  return armHttp(item, ASK_URL, null);
}

// The harness arms: /api/ask/v2 with the model pinned (or 'auto' to let the
// decider pick). One run file per alias.
export const HARNESS_MODELS: Record<string, string> = {
  harness: 'claude-haiku-5-5',
  'harness-sonnet': 'claude-sonnet-5-5',
  'harness-opus': 'claude-opus-5-5',
  'harness-dsflash': 'deepseek/deepseek-v4.1-flash',
  'harness-gemma': 'google/gemma-4-26b-a4b-it',
  'harness-auto': 'auto',
};
const V2_URL = process.env.EVAL_V2_URL || 'http://localhost:3100/api/ask/v2';

async function armHttp(item: Item, url: string, model: string | null): Promise<ArmResult> {
  const cookie = readFileSync(COOKIE_PATH, 'utf8').trim();
  const t0 = Date.now();
  const state = newNdState();
  let status = 0;
  let httpError: string | null = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `atlas_admin=${cookie}` },
      body: JSON.stringify({ query: item.prompt, web: true, ...(model ? { model } : {}) }),
      signal: AbortSignal.timeout(300_000),
    });
    status = res.status;
    if (!res.body) httpError = 'no response body';
    else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        ndFeed(state, dec.decode(value, { stream: true }));
      }
      ndEnd(state);
    }
    if (status !== 200 && !state.events.length) httpError = `HTTP ${status}`;
  } catch (e) {
    httpError = e instanceof Error ? e.message : String(e);
  }
  const s = summarizeEvents(state.events);
  const tags = extractTags(s.answer);
  const resolved = await resolveTags(tags, s.signals).catch(() => tags.map((t) => ({ tag: t, kind: t.split(' ')[0], id: '', title: null })));
  const costUsd = s.cost && typeof s.cost.cost_usd === 'number' ? s.cost.cost_usd : null;
  return {
    answer: s.answer, tags, resolved_tags: resolved, web_sources: s.webSources, cost_usd: costUsd,
    wall_ms: Date.now() - t0, lane: s.lane, lane_reason: s.laneReason, decline: s.decline, verify: s.verify,
    cost_report: s.cost, signals: s.signals, statuses: s.statuses, error: s.error ?? httpError, http_status: status,
    ...(model ? { model, decision: s.decision ?? null, tool_calls: s.toolCalls ?? [] } : {}),
  };
}

type BareContent = { type: string; text?: string; citations?: { url?: string; title?: string }[] | null; content?: unknown };

export function extractBare(content: BareContent[]): { answer: string; sources: WebSource[] } {
  let last = -1;
  content.forEach((b, i) => { if (b.type === 'web_search_tool_result') last = i; });
  const answer = content.slice(last + 1).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  const seen = new Map<string, WebSource>();
  const add = (url?: string, title?: string | null) => { if (url && !seen.has(url)) seen.set(url, { url, title: title ?? null }); };
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content as { url?: string; title?: string }[]) add(r.url, r.title);
    }
    if (b.type === 'text' && Array.isArray(b.citations)) for (const c of b.citations) add(c.url, c.title);
  }
  return { answer, sources: [...seen.values()] };
}

async function armBare(item: Item): Promise<ArmResult> {
  const { cost } = await loadLib();
  const client = new Anthropic();
  const today = localToday();
  const system = `You are a helpful assistant. Today's date is ${today}. Use web search when it helps, and cite your sources with links.`;
  let webTool: 'web_search_20260209' | 'web_search_20250305' = 'web_search_20260209';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: item.prompt }];
  const t0 = Date.now();
  const content: BareContent[] = [];
  const total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, searches: 0 };
  let stop: string | null = null;
  let calls = 0;
  for (let cont = 0; cont <= 3; cont++) {
    const send = (tool: typeof webTool) => client.messages.create({
      model: BARE_MODEL, max_tokens: 8000, system, messages,
      tools: [{ type: tool, name: 'web_search', max_uses: 5 } as Anthropic.ToolUnion],
    });
    const tc = Date.now();
    let res: Anthropic.Message;
    try {
      res = await send(webTool);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (webTool === 'web_search_20260209' && /400|invalid/i.test(m) && /tool|web_search/i.test(m)) {
        webTool = 'web_search_20250305';
        res = await send(webTool);
      } else throw e;
    }
    calls++;
    const u = res.usage as unknown as Record<string, unknown> & { server_tool_use?: { web_search_requests?: number | null } | null };
    await cost.recordApiCall({ feature: 'answer_eval_bare', model: BARE_MODEL, usage: res.usage as never, wallMs: Date.now() - tc });
    total.input_tokens += Number(u.input_tokens ?? 0);
    total.output_tokens += Number(u.output_tokens ?? 0);
    total.cache_creation_input_tokens += Number(u.cache_creation_input_tokens ?? 0);
    total.cache_read_input_tokens += Number(u.cache_read_input_tokens ?? 0);
    total.searches += Number(u.server_tool_use?.web_search_requests ?? 0);
    content.push(...(res.content as unknown as BareContent[]));
    stop = res.stop_reason;
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content as unknown as Anthropic.ContentBlockParam[] });
  }
  const { answer, sources } = extractBare(content);
  const usd = await cost.priceUsage(BARE_MODEL, {
    input_tokens: total.input_tokens, output_tokens: total.output_tokens,
    cache_creation_input_tokens: total.cache_creation_input_tokens, cache_read_input_tokens: total.cache_read_input_tokens,
    server_tool_use: { web_search_requests: total.searches },
  });
  return {
    answer, tags: [], resolved_tags: [], web_sources: sources, cost_usd: usd, wall_ms: Date.now() - t0,
    web_tool: webTool, stop_reason: stop, calls, searches: total.searches, usage: total,
  };
}

export const ARMS: Record<string, Arm> = {
  current: armCurrent,
  bare: armBare,
  ...Object.fromEntries(Object.entries(HARNESS_MODELS).map(([alias, model]) => [alias, (item: Item) => armHttp(item, V2_URL, model)])),
};

// ---------------------------------------------------------------- judge
const scoreProp = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'note'],
  properties: { // The API rejects a nullable enum, so -1 means not applicable (applyApplicability maps it to null).
    score: { type: 'integer', enum: [-1, 0, 1, 2] }, note: { type: 'string' } },
};
export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CRITERIA, 'shape', 'overall', 'flattery', 'em_dash'],
  properties: {
    ...Object.fromEntries(CRITERIA.map((c) => [c, scoreProp])),
    shape: scoreProp,
    overall: { type: 'string' },
    flattery: { type: 'boolean' },
    em_dash: { type: 'boolean' },
  },
};

export function buildJudgeUser(item: Item, a: { answer: string; resolved_tags?: ResolvedTag[]; tags?: string[]; web_sources?: WebSource[] }): string {
  const L: string[] = [];
  L.push(`# Item\nPrompt: ${item.prompt}`);
  L.push(`Wants: ${item.wants.join(', ')}`);
  L.push(`Probes: ${item.probes.length ? item.probes.join(', ') : '(none)'}`);
  L.push(`Great answer bullets:\n${item.great_answer.map((g) => `- ${g}`).join('\n')}`);
  L.push(`Trap: ${item.trap}`);
  L.push(`# Answer under review\n${a.answer || '(empty answer)'}`);
  const tagLines = (a.resolved_tags ?? []).length
    ? a.resolved_tags!.map((t) => `- [${t.tag}] ${t.kind}: ${t.title ?? '(unresolved)'}`)
    : (a.tags ?? []).map((t) => `- [${t}]`);
  L.push(`# Record sources surfaced\n${tagLines.length ? tagLines.join('\n') : '(none)'}`);
  const web = (a.web_sources ?? []).map((w) => `- ${w.title ? `${w.title}: ` : ''}${w.url}`);
  L.push(`# Web sources surfaced\n${web.length ? web.join('\n') : '(none)'}`);
  return L.join('\n\n');
}

export async function judgeOne(item: Item, a: Parameters<typeof buildJudgeUser>[1], feature = 'answer_eval_judge'): Promise<{ judgment: Judgment; cost_usd: number; item_score: number | null }> {
  const { cost } = await loadLib();
  const client = new Anthropic();
  const system = `${readFileSync(RUBRIC_PATH, 'utf8')}\n\nYou are a strict grader. Score only what is on the page. Never use an em dash.`;
  const t = Date.now();
  const res = await client.messages.create({
    model: JUDGE_MODEL, max_tokens: 4000, system,
    messages: [{ role: 'user', content: buildJudgeUser(item, a) }],
    output_config: { format: { type: 'json_schema', schema: JUDGE_SCHEMA }, effort: 'medium' },
  });
  await cost.recordApiCall({ feature, model: JUDGE_MODEL, usage: res.usage as never, wallMs: Date.now() - t });
  const usd = await cost.priceUsage(JUDGE_MODEL, res.usage as never);
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const raw = JSON.parse(text) as Record<string, { score: number | null; note: string }> & { overall: string; flattery: boolean; em_dash: boolean };
  const scores = applyApplicability(raw as unknown as Parameters<typeof applyApplicability>[0], item);
  const sv = raw.shape?.score;
  const shape: CriterionScore = { score: sv === 0 || sv === 1 || sv === 2 ? sv : null, note: String(raw.shape?.note ?? '') };
  return {
    judgment: { scores, shape, overall: String(raw.overall ?? ''), flattery: Boolean(raw.flattery), em_dash: Boolean(raw.em_dash) },
    cost_usd: usd,
    item_score: itemScore(scores),
  };
}

// ---------------------------------------------------------------- report
interface Judged { id: string; item_score: number | null; scores: Record<Criterion, CriterionScore>; shape?: CriterionScore; flattery: boolean; em_dash: boolean; probes: string[]; wants: string[] }
interface RunRow { id: string; cost_usd: number | null; wall_ms: number }

export function buildArmReport(judged: Judged[], runs: RunRow[]) {
  const scored = judged.flatMap((j) => (j.item_score === null ? [] : [j.item_score]));
  const perCriterion = Object.fromEntries(CRITERIA.map((c) => [c, mean(judged.flatMap((j) => (j.scores[c].score === null ? [] : [j.scores[c].score as number])))]));
  const group = (keys: readonly string[], pick: (j: Judged) => string[]) =>
    Object.fromEntries(keys.map((k) => {
      const sel = judged.filter((j) => pick(j).includes(k) && j.item_score !== null);
      return [k, { n: sel.length, mean: mean(sel.map((j) => j.item_score as number)) }];
    }));
  return {
    n: judged.length,
    mean_item_score: mean(scored),
    per_criterion: perCriterion,
    shape: mean(judged.flatMap((j) => (typeof j.shape?.score === 'number' ? [j.shape.score] : []))),
    shape_n: judged.filter((j) => typeof j.shape?.score === 'number').length,
    per_probe: group(PROBES, (j) => j.probes),
    per_wants: group(WANTS, (j) => j.wants),
    flattery_count: judged.filter((j) => j.flattery).length,
    em_dash_count: judged.filter((j) => j.em_dash).length,
    mean_cost_usd: mean(runs.flatMap((r) => (typeof r.cost_usd === 'number' ? [r.cost_usd] : []))),
    mean_wall_s: mean(runs.map((r) => r.wall_ms / 1000)),
  };
}

// ---------------------------------------------------------------- commands
const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? 'n/a' : n.toFixed(d));

async function cmdValidate(flags: Record<string, string | true>): Promise<number> {
  const file = typeof flags.items === 'string' ? path.resolve(flags.items) : DEFAULT_ITEMS;
  if (!existsSync(file)) { console.error(`No items file at ${file}`); return 1; }
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`Invalid JSON: ${(e as Error).message}`); return 1; }
  const v = validateItems(raw, { noMin: flags['no-min'] === true });
  console.log(`${v.items.length} valid items in ${path.relative(REPO, file)}`);
  console.log('per probe:', JSON.stringify(v.probeCounts));
  console.log('per wants:', JSON.stringify(v.wantsCounts));
  if (v.errors.length) { console.error(`\n${v.errors.length} problem(s):\n  ${v.errors.join('\n  ')}`); return 1; }
  console.log('OK');
  return 0;
}

async function cmdRun(flags: Record<string, string | true>): Promise<number> {
  const arm = String(flags.arm ?? '');
  const fn = ARMS[arm];
  if (!fn) { console.error('--arm must be one of: ' + Object.keys(ARMS).join(', ')); return 1; }
  const date = typeof flags.date === 'string' ? flags.date : localToday();
  const items = loadItems(typeof flags.items === 'string' ? path.resolve(flags.items) : DEFAULT_ITEMS);
  const file = runFile(date, arm);
  const todo = pendingItems(items, doneIds(readJsonl(file)), {
    ids: typeof flags.ids === 'string' ? flags.ids.split(',').map((s) => s.trim()) : undefined,
    limit: typeof flags.limit === 'string' ? Number(flags.limit) : undefined,
  });
  console.log(`run ${arm} ${date}: ${todo.length} item(s) to do -> ${path.relative(REPO, file)}`);
  for (const item of todo) {
    await guardSpend();
    const t0 = Date.now();
    let result: ArmResult;
    try {
      result = await fn(item);
    } catch (e) {

      console.error(`  ${item.id}: FAILED ${(e as Error).message}`);
      continue; // not written, so a rerun retries it
    }
    appendLine(file, { id: item.id, arm, date, ...result });
    console.log(`  ${item.id}: ${result.answer.length} chars, $${fmt(result.cost_usd, 4)}, ${((Date.now() - t0) / 1000).toFixed(1)}s${result.error ? ` (error: ${String(result.error)})` : ''}`);
  }
  return 0;
}

async function cmdJudge(flags: Record<string, string | true>): Promise<number> {
  const arm = String(flags.arm ?? '');
  if (!arm) { console.error('--arm required'); return 1; }
  const date = typeof flags.date === 'string' ? flags.date : localToday();
  const itemsFile = typeof flags.items === 'string' ? path.resolve(flags.items) : DEFAULT_ITEMS;
  const items = new Map(loadItems(itemsFile).map((i) => [i.id, i]));
  const runs = readJsonl<{ id: string } & ArmResult>(runFile(date, arm));
  const out = judgedFile(date, arm);
  const done = doneIds(readJsonl(out));
  const todo = runs.filter((r) => !done.has(r.id));
  console.log(`judge ${arm} ${date}: ${todo.length} line(s) to judge`);
  for (const r of todo) {
    const item = items.get(r.id);
    if (!item) { console.error(`  ${r.id}: not in items file, skipped`); continue; }
    await guardSpend();
    const { judgment, cost_usd, item_score } = await judgeOne(item, r);
    appendLine(out, { id: r.id, arm, date, item_score, ...judgment, probes: item.probes, wants: item.wants, judge_cost_usd: cost_usd });
    console.log(`  ${r.id}: ${fmt(item_score)}`);
  }
  return 0;
}

async function cmdReport(flags: Record<string, string | true>): Promise<number> {
  const date = typeof flags.date === 'string' ? flags.date : localToday();
  const arms = Object.keys(ARMS).filter((a) => existsSync(judgedFile(date, a)));
  if (!arms.length) { console.error(`No judged runs for ${date}`); return 1; }
  const report: Record<string, ReturnType<typeof buildArmReport>> = {};
  for (const a of arms) {
    const judged = readJsonl<Judged>(judgedFile(date, a));
    const runs = readJsonl<RunRow>(runFile(date, a)).filter((r) => doneIds(judged).has(r.id));
    report[a] = buildArmReport(judged, runs);
    const r = report[a];
    console.log(`\n== ${a} (n=${r.n}) ==`);
    console.log(`mean item score: ${fmt(r.mean_item_score)}   flattery: ${r.flattery_count}   em dash: ${r.em_dash_count}   mean cost: $${fmt(r.mean_cost_usd, 4)}   mean wall: ${fmt(r.mean_wall_s, 1)}s`);
    console.log('criteria:  ' + CRITERIA.map((c) => `${c}=${fmt(r.per_criterion[c])}`).join('  ') + `   [shape=${fmt(r.shape)} (${r.shape_n}), not in score]`);
    console.log('probes:    ' + PROBES.map((p) => `${p}=${fmt(r.per_probe[p].mean)}(${r.per_probe[p].n})`).join('  '));
    console.log('wants:     ' + WANTS.map((w) => `${w}=${fmt(r.per_wants[w].mean)}(${r.per_wants[w].n})`).join('  '));
  }
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path.join(RUNS_DIR, `${date}-report.json`), JSON.stringify({ date, arms: report }, null, 2));
  return 0;
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  let code = 1;
  try {
    if (cmd === 'validate') code = await cmdValidate(flags);
    else if (cmd === 'run') code = await cmdRun(flags);
    else if (cmd === 'judge') code = await cmdJudge(flags);
    else if (cmd === 'report') code = await cmdReport(flags);
    else console.error('Usage: answer-eval.mts validate|run|judge|report [flags]');
  } catch (e) {
    console.error(e instanceof SpendCapError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`);
    code = 1;
  }
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

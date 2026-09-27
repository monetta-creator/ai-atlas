// The one-time backfill since ChatGPT (2022-11-30) and the reader
// organization's public record. docs/history-backfill.md and
// docs/self-record.md explain the design; lib/history/core.ts holds the pure
// rules (tested by scripts/test-history-core.mjs).
//
// Usage: npx -y tsx scripts/history-backfill.mts <phase> [--dry-run] [--limit=N]
//          [--month=YYYY-MM] [--concurrency=N] [--model=<openrouter id>]
//
// Phases, in order:
//   status        units by phase, Tavily credits this month, spend so far
//   probe         ~40 credits: sample months, result counts, in-window share
//   collect       Tavily news windows per month x lens -> history_items
//   triage        cheap model keeps what mattered, with a significance
//   landmarks     up to 8 per month, deduped across lenses
//   draft         landmarks -> candidates on ONE backfill pipeline run ->
//                 draft signals (origin 'backfill'), never published here
//   self-sec, self-news, self-research, self-patents, self-regulatory,
//   self-summarize, self-timeline, self-profile   (Part B, see below)
//
// Guard rails (the reason this is a script and not an engine):
//   - it never writes the day-keyed engine tables, whose readers window on
//     created_at; everything lands in history_items / self_record keyed on the
//     article's own date
//   - every model call logs under history_* or self_record_* features, which
//     no live budget checker sums; this script stops at --cap (default $25)
//   - Tavily: it stops TAVILY_RESERVE credits short of the monthly cap so the
//     live crons never see a 432
//   - idempotent: backfill_units rows + unique URLs; --dry-run prints the plan
//
// Env: SUPABASE_DB_PASSWORD (builds a transaction-pooler URL, like
// scripts/ab-retrieval-run.mts), TAVILY_API_KEY, OPENROUTER_API_KEY,
// ANTHROPIC_API_KEY; optional DATA_GOV_API_KEY, PATENTSVIEW_API_KEY,
// RESEARCH_CONTACT_EMAIL (SEC and OpenAlex etiquette).

import { config } from 'dotenv';
config({ path: '.env.local' });

const PROJECT_REF = 'wuyxchwgasjefbswpxvm';
const POOLER_HOST = 'aws-1-us-east-2.pooler.supabase.com';
if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error('SUPABASE_DB_PASSWORD not set (expected in .env.local).');
  process.exit(1);
}
process.env.DATABASE_URL = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@${POOLER_HOST}:6543/postgres`;
process.env.DB_POOL_MAX = '2';

const { q, one, exec } = await import('../lib/db.ts');
const { recordApiCall } = await import('../lib/cost.ts');
const { tavilyQuery } = await import('../lib/scan/search-tavily.ts');
const core = await import('../lib/history/core.ts');
import type { MonthWindow, Lens, KeptItem, TimelineEvent, TimelineEventIn } from '../lib/history/core.ts';

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const phase = argv[0] ?? 'status';
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DRY = argv.includes('--dry-run');
const LIMIT = flag('limit') ? Number(flag('limit')) : Infinity;
const ONLY_MONTH = flag('month');
const CONCURRENCY = Math.max(1, Number(flag('concurrency') ?? 4));
const CAP_USD = Number(flag('cap') ?? 25);
// Triage and filing run on Haiku by default: the forced tool parses reliably, where the
// flash model dropped most verdicts and failed to parse the busiest batches (2026-09-27).
const UTILITY_MODEL = flag('model') ?? 'claude-haiku-4-5';
const TAVILY_CAP = Number(process.env.TAVILY_MONTHLY_CAP || 4000);

// ------------------------------------------------------------------ shared
export const FEATURE_LIKE = `(feature like 'history\\_%' or feature like 'self\\_record\\_%')`;

async function spentUsd(): Promise<number> {
  const r = await one<{ usd: number }>(`select coalesce(sum(cost_usd), 0)::float as usd from ai_cost_log where ${FEATURE_LIKE}`);
  return r?.usd ?? 0;
}
async function tavilyMonthToDate(): Promise<number> {
  const r = await one<{ n: number }>(
    `select coalesce(sum((metadata->>'queries')::int), 0)::int as n from ai_cost_log
      where model = 'tavily-search' and created_at >= date_trunc('month', now())`);
  return r?.n ?? 0;
}
async function assertBudget(creditsNeeded = 0): Promise<void> {
  const usd = await spentUsd();
  if (usd >= CAP_USD) throw new StopError(`spend cap reached: $${usd.toFixed(2)} of $${CAP_USD}`);
  if (creditsNeeded > 0) {
    const room = core.tavilyRoom(await tavilyMonthToDate(), TAVILY_CAP);
    if (room < creditsNeeded) throw new StopError(`Tavily reserve reached: ${room} credits of room, need ${creditsNeeded} (cap ${TAVILY_CAP}, reserve ${core.TAVILY_RESERVE})`);
  }
}
class StopError extends Error {}

async function unitDone(key: string): Promise<boolean> {
  const r = await one<{ status: string }>(`select status from backfill_units where key = $1`, [key]);
  return r?.status === 'done' || r?.status === 'skipped';
}
// A unit skipped for a missing key runs once the key exists: 'skipped' only
// counts as done while the key is still absent.
async function unitDoneOrStillBlocked(key: string, keyPresent: boolean): Promise<boolean> {
  const r = await one<{ status: string }>(`select status from backfill_units where key = $1`, [key]);
  return r?.status === 'done' || (r?.status === 'skipped' && !keyPresent);
}
async function markUnit(key: string, p: string, status: string, extra: { credits?: number; items?: number; note?: string; cost?: number } = {}) {
  await exec(
    `insert into backfill_units (key, phase, status, credits, items, note, cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (key) do update set status = excluded.status, credits = backfill_units.credits + excluded.credits,
       items = excluded.items, note = excluded.note, cost_usd = backfill_units.cost_usd + excluded.cost_usd`,
    [key, p, status, extra.credits ?? 0, extra.items ?? 0, extra.note ?? null, extra.cost ?? 0]
  );
}

// One Tavily window query, logged like every other Tavily call ($0 row,
// metadata.queries) under the history feature so the quota tile counts it.
async function searchWindow(query: string, w: { start: string; end: string }, opts: { topic?: 'news' | 'general'; includeDomains?: string[]; maxResults?: number } = {}) {
  const t0 = Date.now();
  try {
    return await tavilyQuery({
      query, topic: opts.topic ?? 'news', startDate: w.start, endDate: w.end,
      maxResults: opts.maxResults ?? 20, includeDomains: opts.includeDomains,
    });
  } finally {
    await recordApiCall({ feature: 'history_search', model: 'tavily-search', usage: null, wallMs: Date.now() - t0, metadata: { queries: 1, window: w.start } });
  }
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      await fn(x);
    }
  });
  await Promise.all(workers);
}

function windows() {
  const all = core.monthWindows();
  return ONLY_MONTH ? all.filter((w) => w.month.startsWith(ONLY_MONTH)) : all;
}

async function selfRow() {
  const r = await one<{ slug: string; name: string; aliases: string[]; domain: string | null; cik: string | null; fdic_cert: string | null; rssd_id: string | null; cfpb_name: string | null }>(
    `select slug, name, aliases, domain, cik, fdic_cert, rssd_id, cfpb_name from intel_companies where tier = 'self' and active limit 1`);
  if (!r) throw new StopError('no active self row in intel_companies');
  return r;
}

// ------------------------------------------------------------------ status
async function status() {
  const units = await q<{ phase: string; status: string; n: number; credits: number; items: number; usd: number }>(
    `select phase, status, count(*)::int n, sum(credits)::int credits, sum(items)::int items, sum(cost_usd)::float usd
       from backfill_units group by 1, 2 order by 1, 2`);
  console.table(units);
  const byFeature = await q<{ feature: string; calls: number; usd: number }>(
    `select feature, count(*)::int calls, round(sum(cost_usd)::numeric, 4)::float usd from ai_cost_log where ${FEATURE_LIKE} group by 1 order by 1`);
  console.table(byFeature);
  const mtd = await tavilyMonthToDate();
  console.log(`Tavily this month: ${mtd} of ${TAVILY_CAP} (room for the backfill: ${core.tavilyRoom(mtd, TAVILY_CAP)})`);
  console.log(`Backfill spend: $${(await spentUsd()).toFixed(3)} of $${CAP_USD}`);
  const hist = await q<{ triage: string; n: number; landmarks: number; drafted: number }>(
    `select triage, count(*)::int n, count(*) filter (where landmark)::int landmarks, count(signal_id)::int drafted from history_items group by 1`);
  if (hist.length) console.table(hist);
  const rec = await q<{ source: string; n: number; ai: number }>(
    `select source, count(*)::int n, count(*) filter (where ai_related)::int ai from self_record group by 1 order by 2 desc`);
  if (rec.length) console.table(rec);
}

// ------------------------------------------------------------------ probe
async function probe() {
  const sample = ['2022-12', '2023-04', '2023-10', '2024-03', '2024-09', '2025-03', '2025-09', '2026-05'];
  const ws = core.monthWindows().filter((w) => sample.some((m) => w.month.startsWith(m)));
  const self = await selfRow();
  const plan: { key: string; query: string; w: MonthWindow; kind: string }[] = [];
  for (const w of ws) {
    for (const lens of ['capability', 'market', 'regulatory'] as Lens[]) {
      plan.push({ key: `probe:${w.month}:${lens}`, query: core.lensQueriesFor(lens, w)[0], w, kind: lens });
    }
    const sq = core.selfQueriesFor(self.name, w);
    plan.push({ key: `probe:${w.month}:self-ai`, query: sq[0], w, kind: 'self-ai' });
    plan.push({ key: `probe:${w.month}:self-news`, query: sq[2], w, kind: 'self-news' });
  }
  console.log(`probe: ${plan.length} queries (${plan.length} credits)`);
  if (DRY) { plan.forEach((p) => console.log(`  ${p.key}  ${p.kind === 'self-ai' || p.kind === 'self-news' ? '<self query>' : p.query}`)); return; }
  await assertBudget(plan.length);
  const rows: Record<string, string | number>[] = [];
  for (const p of plan) {
    if (await unitDone(p.key)) continue;
    const res = await searchWindow(p.query, p.w);
    const days = res.map((r) => core.isoDay(r.published_date));
    const inWin = days.filter((d) => core.inWindow(d, p.w)).length;
    rows.push({ month: p.w.month.slice(0, 7), kind: p.kind, results: res.length, dated: days.filter(Boolean).length, in_window: inWin,
      sample: (res[0]?.title ?? '').slice(0, 60) });
    await markUnit(p.key, 'probe', 'done', { credits: 1, items: res.length, note: `${inWin}/${res.length} in window` });
  }
  console.table(rows);
}

// ------------------------------------------------------------------ Part A
const { normalizeUrl, domainOfUrl } = await import('../lib/pack-shared.ts');
const { rateDomainByRule } = await import('../lib/scan/source-tiers.ts');
const { routedStructured } = await import('../lib/model-route.ts');

let tierCache: Map<string, { tier: number; kind: string }> | null = null;
async function tierFor(domain: string | null): Promise<{ tier: number | null; kind: string | null }> {
  if (!domain) return { tier: null, kind: null };
  if (!tierCache) {
    const rows = await q<{ domain: string; tier: number; kind: string }>(`select domain, tier, kind from source_tiers`);
    tierCache = new Map(rows.map((r) => [r.domain, { tier: r.tier, kind: r.kind }]));
  }
  const hit = tierCache.get(domain) ?? tierCache.get(domain.split('.').slice(-2).join('.'));
  if (hit) return hit;
  const rule = rateDomainByRule(domain);
  return rule ? { tier: rule.tier, kind: rule.kind } : { tier: null, kind: null };
}

let knownUrls: Set<string> | null = null;
async function alreadyTracked(key: string): Promise<boolean> {
  if (!knownUrls) {
    const rows = await q<{ url: string }>(
      `select url from sources where url is not null
       union select url from signal_candidates
       union select url from intel_items`);
    knownUrls = new Set(rows.map((r) => normalizeUrl(r.url)));
  }
  return knownUrls.has(key);
}

async function collect() {
  const plan: { key: string; w: MonthWindow; lens: Lens; queries: string[] }[] = [];
  for (const w of windows()) {
    for (const lens of core.LENSES) plan.push({ key: `collect:${w.month}:${lens}`, w, lens, queries: core.lensQueriesFor(lens, w) });
    // the roundup's items are filed under 'capability' until the triage assigns their lens
    plan.push({ key: `collect:${w.month}:roundup`, w, lens: 'capability', queries: [core.roundupQueryFor(w)] });
  }
  const todo: typeof plan = [];
  for (const p of plan) if (!(await unitDone(p.key))) todo.push(p);
  const credits = todo.reduce((n, p) => n + p.queries.length, 0);
  console.log(`collect: ${todo.length} of ${plan.length} units to run, ${credits} credits`);
  if (DRY) return;
  let done = 0;
  for (const p of todo.slice(0, LIMIT)) {
    await assertBudget(p.queries.length);
    let inserted = 0;
    for (const query of p.queries) {
      const res = await searchWindow(query, p.w);
      for (const r of res) {
        if (!r.url || !r.title) continue;
        const day = core.isoDay(r.published_date);
        if (!day || !core.inWindow(day, p.w)) continue;
        const key = normalizeUrl(r.url);
        const domain = domainOfUrl(r.url);
        const t = await tierFor(domain);
        const dup = await alreadyTracked(key);
        const row = await one<{ id: string }>(
          `insert into history_items (url, url_key, title, snippet, published_date, window_month, lens, query, domain, source_tier, source_kind, triage)
           values ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12)
           on conflict (url_key) do nothing returning id`,
          [r.url, key, r.title.slice(0, 400), (r.content ?? '').slice(0, 1500) || null, day, p.w.month, p.lens,
            p.key.endsWith(':roundup') ? 'roundup' : query, domain, t.tier, t.kind, dup ? 'duplicate' : 'pending']
        );
        if (row) inserted += 1;
      }
    }
    await markUnit(p.key, 'collect', 'done', { credits: p.queries.length, items: inserted });
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${todo.length} units`);
  }
  console.log(`collect: ${done} units run`);
}

interface TriageOut { keep: { i: number; significance?: string; lens?: string }[] }
// The model lists only what it keeps; every other item in a parsed batch is
// rejected. Asking for a verdict on every item made the utility model answer a
// handful and drop the rest (December 2022: 64 of 81 unanswered), the
// truncation-looks-like-harshness failure again. A batch that fails to parse
// stays pending for the next run.
const TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    keep: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          i: { type: 'integer' },
          significance: { type: 'string', enum: ['high', 'medium', 'low'] },
          lens: { type: 'string', enum: core.LENSES },
        },
        required: ['i', 'significance', 'lens'],
      },
    },
  },
  required: ['keep'],
};
const TRIAGE_SYSTEM = `You are building a history of the AI economy since ChatGPT's launch in November 2022, one month at a time. Each numbered item is a news result: headline, date, outlet, snippet.
Keep an item only when it reports a real, material development in AI during that month: a model or product release that mattered, a major funding round, deal or earnings signal, a government policy, law, ruling or enforcement action, an export control, a study with data on jobs, productivity or adoption, a major enterprise deployment, or a notable public controversy. Reject listicles, newsletters, month or year roundups, "what's next" and explainer pieces, how-to pieces, vendor marketing, minor product updates, opinion without news, event announcements, and anything not about AI.
For each kept item give significance: high = would appear in a year-end review of AI (rare: at most two or three in a batch); medium = mattered that month; low = minor but real. And give the single best lens: market (money, valuations, spending), labor (jobs, productivity, adoption at work), geopolitics (national competition, chips, supply chains), regulatory (rules, courts, enforcement), capability (what models can do, releases, research), society (public attitudes, culture, harms, education).
List ONLY the items you keep, by their number, each with significance and lens. Omit everything you reject. Never use an em dash.`;

async function triage() {
  const groups = await q<{ window_month: string; lens: string; n: number }>(
    `select window_month::text, lens::text, count(*)::int n from history_items where triage = 'pending'
     ${ONLY_MONTH ? `and to_char(window_month, 'YYYY-MM') = '${ONLY_MONTH.replace(/[^0-9-]/g, '')}'` : ''}
     group by 1, 2 order by 1, 2`);
  console.log(`triage: ${groups.length} month-lens batches, ${groups.reduce((n, g) => n + g.n, 0)} items`);
  if (DRY) return;
  let batches = 0;
  await pool(groups.slice(0, LIMIT), CONCURRENCY, async (g) => {
    await assertBudget();
    const items = await q<{ id: string; title: string; snippet: string | null; published_date: string; domain: string | null }>(
      `select id, title, snippet, published_date::text, domain from history_items
        where triage = 'pending' and window_month = $1::date and lens = $2 order by published_date`,
      [g.window_month, g.lens]);
    for (let c = 0; c < items.length; c += 30) await triageChunk(g, items.slice(c, c + 30));
    batches += 1;
    if (batches % 25 === 0) console.log(`  ${batches}/${groups.length} batches, spend $${(await spentUsd()).toFixed(3)}`);
  });
  console.log(`triage: ${batches} batches done`);
}

async function triageChunk(g: { window_month: string; lens: string }, items: { id: string; title: string; snippet: string | null; published_date: string; domain: string | null }[]) {
    if (!items.length) return;
    const list = items.map((it, i) => `${i + 1}. [${it.published_date} · ${it.domain ?? 'unknown'}] ${it.title}\n   ${(it.snippet ?? '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
    let out: TriageOut;
    try {
      out = await routedStructured<TriageOut>({
        model: UTILITY_MODEL, system: TRIAGE_SYSTEM,
        user: `MONTH: ${g.window_month.slice(0, 7)}\nITEMS:\n${list}`,
        toolName: 'submit_triage', toolDescription: 'Keep or reject each item.', schema: TRIAGE_SCHEMA,
        maxTokens: 4000, timeoutMs: 90_000, feature: 'history_triage',
        metadata: { window: g.window_month, lens: g.lens, items: items.length },
      });
    } catch (e) {
      console.warn(`  triage failed ${g.window_month} ${g.lens}: ${(e as Error).message.slice(0, 120)}`);
      return;
    }
    if (!Array.isArray(out.keep)) { console.warn(`  triage unparsable ${g.window_month} ${g.lens}`); return; }
    const byIdx = new Map(out.keep.map((d) => [Number(d.i), d]));
    for (let i = 0; i < items.length; i++) {
      const d = byIdx.get(i + 1);
      const sig = d && ['high', 'medium', 'low'].includes(String(d.significance)) ? d.significance : 'low';
      const lens = d && core.LENSES.includes(d.lens as Lens) ? d.lens : g.lens;
      await exec(
        `update history_items set triage = $1, significance = $2, lens = $3::signal_lens_t where id = $4`,
        [d ? 'kept' : 'rejected', d ? sig : null, lens, items[i].id]);
    }
}

async function landmarks() {
  let total = 0;
  for (const w of windows()) {
    const kept = await q<KeptItem>(
      `select id, title, lens::text as lens, significance, source_tier, published_date::text
         from history_items where triage = 'kept' and window_month = $1::date`, [w.month]);
    const picks = core.pickLandmarks(kept);
    if (DRY) { console.log(`${w.label}: ${picks.length} of ${kept.length}`); picks.forEach((p) => console.log(`   [${p.lens}/${p.significance}] ${p.title.slice(0, 90)}`)); continue; }
    await exec(`update history_items set landmark = false where window_month = $1::date and signal_id is null`, [w.month]);
    if (picks.length) await exec(`update history_items set landmark = true where id = any($1::uuid[])`, [picks.map((p) => p.id)]);
    total += picks.length;
  }
  console.log(`landmarks: ${total}`);
}

const ANALYSIS_MODEL = flag('analysis-model') ?? 'claude-haiku-4-5';
async function backfillRunId(): Promise<string> {
  const r = await one<{ id: string }>(`select id from pipeline_runs where cadence = 'backfill' order by triggered_at limit 1`);
  if (r) return r.id;
  const row = await one<{ id: string }>(`insert into pipeline_runs (cadence, status, step) values ('backfill', 'running', 'analysis') returning id`);
  return row!.id;
}

async function draft() {
  const { fetchCandidateText, MIN_READABLE_CHARS } = await import('../lib/pipeline/web.ts');
  const { analyzeCandidate } = await import('../lib/pipeline/analysis.ts');
  const m = await import('../lib/mutations/index.ts');
  const todo = await q<{ id: string; url: string; title: string; snippet: string | null; published_date: string; lens: string; domain: string | null; candidate_id: string | null }>(
    `select id, url, title, snippet, published_date::text, lens::text, domain, candidate_id from history_items
      where landmark and signal_id is null and triage = 'kept'
      ${ONLY_MONTH ? `and to_char(window_month, 'YYYY-MM') = '${ONLY_MONTH.replace(/[^0-9-]/g, '')}'` : ''}
      order by published_date`);
  console.log(`draft: ${todo.length} landmarks to draft with ${ANALYSIS_MODEL}`);
  if (DRY || !todo.length) return;
  const runId = await backfillRunId();
  let drafted = 0; let failed = 0;
  await pool(todo.slice(0, LIMIT), Math.min(CONCURRENCY, 3), async (h) => {
    await assertBudget();
    let candId = h.candidate_id;
    if (!candId) {
      const c = await one<{ id: string }>(
        `insert into signal_candidates (run_id, lens, url, headline, source_domain, published_date, triage_status, triage_reason, discovery_queries)
         values ($1, $2, $3, $4, $5, $6::date, 'approved', 'history backfill landmark', $7)
         on conflict (run_id, url) do update set updated_at = now() returning id`,
        [runId, h.lens, h.url, h.title, h.domain, h.published_date, ['history-backfill']]);
      candId = c!.id;
      await exec(`update history_items set candidate_id = $1 where id = $2`, [candId, h.id]);
    }
    // Page text first; an old article often 404s, so the headline + snippet is the fallback
    // when it alone clears the readable floor (the draft is weaker but honest about its source).
    let text: string | null = null;
    try {
      const f = await fetchCandidateText(h.url, { timeoutMs: 20_000, allowFallback: true });
      text = f.text;
      await m.setCandidateRawContent(candId, f.text, f.via);
    } catch {
      const fallback = `${h.title}\n\n${h.snippet ?? ''}`.trim();
      if (fallback.length >= MIN_READABLE_CHARS) { text = fallback; await m.setCandidateRawContent(candId, fallback); }
    }
    if (!text) { failed += 1; await exec(`update signal_candidates set analysis_status = 'error', analysis_error = 'page gone, snippet too short' where id = $1`, [candId]); return; }
    try {
      const res = await analyzeCandidate(candId, ANALYSIS_MODEL, { feature: 'history_analysis', origin: 'backfill' });
      const sid = res?.signalId ?? (await one<{ signal_id: string }>(`select signal_id from signal_candidates where id = $1`, [candId]))?.signal_id ?? null;
      if (sid) { await exec(`update history_items set signal_id = $1 where id = $2`, [sid, h.id]); drafted += 1; }
    } catch (e) {
      failed += 1;
      await exec(`update signal_candidates set analysis_status = 'error', analysis_error = $1 where id = $2`, [(e as Error).message.slice(0, 300), candId]);
    }
    if ((drafted + failed) % 20 === 0) console.log(`  ${drafted} drafted, ${failed} failed, spend $${(await spentUsd()).toFixed(3)}`);
  });
  await m.recomputeRunCounts(runId);
  const left = await one<{ n: number }>(`select count(*)::int n from history_items where landmark and signal_id is null and triage = 'kept'`);
  if (!left?.n) await m.updateRun(runId, { status: 'completed', step: 'complete' });
  console.log(`draft: ${drafted} drafted, ${failed} failed`);
}

// ------------------------------------------------------------------ Part B: the self record
const src = await import('../lib/history/self-sources.ts');
const TODAY = new Date().toISOString().slice(0, 10);
const SYNTH_MODEL = flag('synth-model') ?? 'claude-sonnet-4-6';

async function insertRecord(slug: string, r: {
  source: string; title: string; url: string; published_date: string | null; summary?: string | null;
  ai_passages?: string[]; text_excerpt?: string | null; metadata?: Record<string, unknown>;
}): Promise<boolean> {
  // Postgres text rejects NUL; some SEC documents carry them.
  const clean = (v: string | null | undefined) => (v == null ? null : v.replace(/\u0000/g, ''));
  const passages = (r.ai_passages ?? []).map((p) => clean(p) as string);
  const row = await one<{ id: string }>(
    `insert into self_record (company_slug, source, title, url, published_date, summary, ai_related, ai_passages, text_excerpt, metadata)
     values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
     on conflict (url) do nothing returning id`,
    [slug, r.source, (clean(r.title) ?? '').slice(0, 400), r.url, r.published_date, clean(r.summary), passages.length > 0,
      passages, r.text_excerpt ? (clean(r.text_excerpt) ?? '').slice(0, 8000) : null, r.metadata ?? {}]);
  return Boolean(row);
}

async function selfSec() {
  const self = await selfRow();
  if (!self.cik) throw new StopError('the self row has no CIK');
  const filings = await src.listSecFilings(self.cik, core.HISTORY_START);
  const byForm = filings.reduce<Record<string, number>>((m, f) => ((m[f.form] = (m[f.form] ?? 0) + 1), m), {});
  console.log(`self-sec: ${filings.length} filings since ${core.HISTORY_START}`, byForm);
  if (DRY) return;
  let n = 0;
  for (const f of filings.slice(0, LIMIT)) {
    const key = `self-sec:${f.accession}`;
    if (await unitDone(key)) continue;
    try {
      const base = f.form.split('/')[0];
      if (base === '8-K') {
        const pr = await src.findPressRelease(f.indexUrl).catch(() => null);
        const url = pr?.url ?? f.url;
        const text = await src.fetchSecText(url);
        const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 25 && l.length < 200) ?? '';
        await insertRecord(self.slug, {
          source: pr ? 'sec_exhibit' : 'sec_filing',
          title: pr ? (firstLine || `8-K press release, ${f.filingDate}`) : `8-K, ${f.filingDate}${f.items ? ` (items ${f.items})` : ''}`,
          url, published_date: f.filingDate, ai_passages: core.extractAiPassages(text, { max: 6 }),
          text_excerpt: text.slice(0, 6000), metadata: { form: f.form, accession: f.accession, items: f.items, exhibit: pr?.name ?? null },
        });
      } else {
        const text = await src.fetchSecText(f.url);
        const passages = core.extractAiPassages(text, { max: base === '425' ? 4 : 12 });
        await insertRecord(self.slug, {
          source: base === 'S-4' || base === '425' ? 'merger' : 'sec_filing',
          title: `${f.form}${f.description && f.description !== f.form ? `: ${f.description}` : ''}, filed ${f.filingDate}`,
          url: f.url, published_date: f.filingDate, ai_passages: passages,
          text_excerpt: base === '425' || base === '8-K' ? text.slice(0, 4000) : null,
          metadata: { form: f.form, accession: f.accession, chars: text.length, ai_passages_found: passages.length },
        });
      }
      await markUnit(key, 'self-sec', 'done', { items: 1 });
    } catch (e) {
      await markUnit(key, 'self-sec', 'failed', { note: (e as Error).message.slice(0, 200) });
    }
    n += 1;
    if (n % 25 === 0) console.log(`  ${n}/${filings.length}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`self-sec: ${n} filings processed`);
}

async function selfNews() {
  const self = await selfRow();
  const known = new Set((await q<{ url: string }>(`select url from intel_items where $1 = any(company_slugs)`, [self.slug])).map((r) => normalizeUrl(r.url)));
  const plan = windows().map((w) => ({ key: `self-news:${w.month}`, w }));
  const todo: typeof plan = [];
  for (const p of plan) if (!(await unitDone(p.key))) todo.push(p);
  const perUnit = core.SELF_QUERY_TEMPLATES.length + (self.domain ? 1 : 0);
  console.log(`self-news: ${todo.length} months, ${todo.length * perUnit} credits`);
  if (DRY) return;
  for (const p of todo.slice(0, LIMIT)) {
    await assertBudget(perUnit);
    let inserted = 0;
    const runs: { query: string; domains?: string[]; topic: 'news' | 'general' }[] =
      core.selfQueriesFor(self.name, p.w).map((query) => ({ query, topic: 'news' as const }));
    if (self.domain) runs.push({ query: `"${self.name}"`, domains: [self.domain], topic: 'general' });
    for (const r of runs) {
      const t0 = Date.now();
      let res: Awaited<ReturnType<typeof tavilyQuery>> = [];
      try {
        res = await tavilyQuery({ query: r.query, topic: r.topic, startDate: p.w.start, endDate: p.w.end, maxResults: 20, includeDomains: r.domains, exactMatch: true });
      } finally {
        await recordApiCall({ feature: 'history_search', model: 'tavily-search', usage: null, wallMs: Date.now() - t0, metadata: { queries: 1, window: p.w.start, self: true } });
      }
      for (const x of res) {
        if (!x.url || !x.title) continue;
        const day = core.isoDay(x.published_date);
        if (r.topic === 'news' && (!day || !core.inWindow(day, p.w))) continue;
        if (known.has(normalizeUrl(x.url))) continue;
        const own = self.domain && (domainOfUrl(x.url) ?? '').endsWith(self.domain);
        if (await insertRecord(self.slug, {
          source: own ? 'newsroom' : 'news', title: x.title, url: x.url, published_date: day ?? p.w.start,
          text_excerpt: x.content ?? null, metadata: { query: r.query.replace(self.name, '{name}'), window: p.w.month },
        })) inserted += 1;
      }
    }
    await markUnit(p.key, 'self-news', 'done', { credits: perUnit, items: inserted });
  }
  console.log('self-news: done');
}

async function selfResearch() {
  const self = await selfRow();
  const inst = await src.resolveInstitution(self.name);
  if (!inst) { await markUnit('self-research:openalex', 'self-research', 'skipped', { note: 'no institution match' }); console.log('no OpenAlex institution matched'); return; }
  console.log(`OpenAlex institution: ${inst.id} (${inst.works} works overall)`);
  const works = await src.listOpenAlexWorks(inst.id, core.HISTORY_START);
  console.log(`self-research: ${works.length} works since ${core.HISTORY_START}`);
  if (DRY) { works.slice(0, 10).forEach((w) => console.log(`  ${w.published} ${w.title.slice(0, 90)}`)); return; }
  let n = 0;
  for (const w of works) {
    const blob = `${w.title}. ${w.abstract} ${w.concepts.join(' ')}`;
    const ai = core.AI_TERMS_RE.test(blob) || w.concepts.some((c) => /machine learning|artificial intelligence|deep learning|natural language|neural/i.test(c));
    if (await insertRecord(self.slug, {
      source: 'paper', title: w.title, url: w.url, published_date: w.published,
      summary: w.abstract ? w.abstract.split(/(?<=\.)\s/).slice(0, 2).join(' ').slice(0, 600) : null,
      ai_passages: ai && w.abstract ? [w.abstract.slice(0, 1200)] : [], text_excerpt: w.abstract || null,
      metadata: { openalex: w.id, doi: w.doi, venue: w.venue, cited_by: w.cited, concepts: w.concepts, type: w.type, institution: inst.id },
    })) n += 1;
  }
  await markUnit('self-research:openalex', 'self-research', 'done', { items: n, note: inst.id });
  console.log(`self-research: ${n} papers recorded`);
}

async function selfPatents() {
  const self = await selfRow();
  if (!src.usptoKey()) {
    await markUnit('self-patents:uspto', 'self-patents', 'skipped', { note: 'PATENTSVIEW_API_KEY (USPTO ODP key) not set' });
    console.log('self-patents: skipped, PATENTSVIEW_API_KEY not set'); return;
  }
  const pats = await src.listPatents(self.name, core.HISTORY_START);
  const ai = pats.filter((p) => p.cpc.some((c) => c.replace(/\s+/g, '').startsWith('G06N')) || core.AI_TERMS_RE.test(p.title));
  console.log(`self-patents: ${pats.length} granted since ${core.HISTORY_START}, ${ai.length} AI-related`);
  if (DRY) return;
  // Every AI patent is a record; the rest are counted per quarter on one summary row's metadata.
  let n = 0;
  for (const p of ai) {
    if (await insertRecord(self.slug, {
      source: 'patent', title: p.title, url: p.url, published_date: p.date,
      summary: null, ai_passages: [p.title], // no abstract in the ODP; the title marks it AI-related
      text_excerpt: null, metadata: { patent: p.number, cpc: p.cpc.slice(0, 12), applicant: p.applicant },
    })) n += 1;
  }
  const perQuarter: Record<string, { all: number; ai: number }> = {};
  for (const p of pats) {
    const qk = `${p.date.slice(0, 4)}Q${Math.floor((Number(p.date.slice(5, 7)) - 1) / 3) + 1}`;
    perQuarter[qk] ??= { all: 0, ai: 0 };
    perQuarter[qk].all += 1;
    if (ai.includes(p)) perQuarter[qk].ai += 1;
  }
  await markUnit('self-patents:uspto', 'self-patents', 'done', { items: n, note: JSON.stringify(perQuarter).slice(0, 1800) });
  console.log(`self-patents: ${n} AI patents recorded`);
}

const REG_DOMAINS = ['occ.gov', 'federalreserve.gov', 'fdic.gov', 'consumerfinance.gov', 'justice.gov', 'ftc.gov'];
async function selfRegulatory() {
  const self = await selfRow();
  const { fetchCandidateText } = await import('../lib/pipeline/web.ts');
  const queries: { key: string; query: string; source: string }[] = [
    { key: 'self-reg:enforcement', query: `"${self.name}" enforcement action consent order`, source: 'enforcement' },
    { key: 'self-reg:penalty', query: `"${self.name}" civil money penalty settlement`, source: 'enforcement' },
    { key: 'self-reg:merger', query: `"${self.name}" merger application approval order`, source: 'merger' },
    { key: 'self-reg:ai', query: `"${self.name}" artificial intelligence model risk`, source: 'enforcement' },
  ];
  console.log(`self-regulatory: ${queries.length} regulator-domain searches + comment letters + testimony`);
  if (DRY) return;
  const w = { start: core.HISTORY_START, end: TODAY };
  for (const r of queries) {
    if (await unitDone(r.key)) continue;
    await assertBudget(1);
    const res = await searchWindow(r.query, w, { topic: 'general', includeDomains: REG_DOMAINS });
    let n = 0;
    for (const x of res) {
      if (!x.url || !x.title) continue;
      let text = x.content ?? '';
      try { text = (await fetchCandidateText(x.url, { timeoutMs: 25_000, allowFallback: false })).text; } catch { /* keep the snippet */ }
      if (!text.toLowerCase().includes(self.name.toLowerCase())) continue; // a regulator page that never names it
      if (await insertRecord(self.slug, {
        source: r.source, title: x.title, url: x.url, published_date: core.isoDay(x.published_date),
        ai_passages: core.extractAiPassages(text, { max: 4 }), text_excerpt: text.slice(0, 6000),
        metadata: { agency: domainOfUrl(x.url), query: r.key },
      })) n += 1;
    }
    await markUnit(r.key, 'self-regulatory', 'done', { credits: 1, items: n });
  }
  for (const [key, fn, source] of [
    ['self-reg:comments', src.listCommentLetters, 'comment_letter'],
    ['self-reg:testimony', src.listTestimony, 'testimony'],
  ] as const) {
    if (await unitDoneOrStillBlocked(key, Boolean(process.env.DATA_GOV_API_KEY))) continue;
    if (!process.env.DATA_GOV_API_KEY) { await markUnit(key, 'self-regulatory', 'skipped', { note: 'DATA_GOV_API_KEY not set' }); continue; }
    try {
      const docs = await fn(self.name, core.HISTORY_START);
      console.log(`  ${key}: ${docs.length} documents`);
      let n = 0;
      for (const d of docs) {
        // The letter or hearing text: the attached PDF when there is one. A
        // hearing transcript is long; only its AI paragraphs and the passages
        // that name the organization are kept.
        let text = '';
        if (d.attachmentUrl) {
          try { text = (await fetchCandidateText(d.attachmentUrl, { timeoutMs: 45_000, allowFallback: false, maxChars: 400_000 })).text; } catch { /* keep the title */ }
        }
        const passages = core.extractAiPassages(text, { max: source === 'testimony' ? 8 : 10 });
        if (source === 'testimony' && !passages.some((p) => p.toLowerCase().includes(self.name.toLowerCase()))
          && !text.toLowerCase().includes(self.name.toLowerCase())) continue;
        const title = source === 'comment_letter'
          ? `Comment letter to ${d.agency ?? 'a regulator'}${d.docketTitle ? ` on ${d.docketTitle}` : ''}`
          : d.title;
        if (await insertRecord(self.slug, {
          source, title, url: d.url, published_date: d.date, ai_passages: passages,
          text_excerpt: text ? text.slice(0, 8000) : null,
          metadata: { agency: d.agency, id: d.id, docket: d.docket ?? null, docket_title: d.docketTitle ?? null, attachment: d.attachmentUrl ? d.attachmentUrl.replace(/api_key=[^&]+/, 'api_key=') : null },
        })) n += 1;
      }
      await markUnit(key, 'self-regulatory', 'done', { items: n });
    } catch (e) {
      await markUnit(key, 'self-regulatory', 'failed', { note: (e as Error).message.slice(0, 200) });
    }
  }
  console.log('self-regulatory: done');
}

// ---- summaries: relevance gate + dimension + one or two factual sentences ----
const DIMENSIONS = ['strategy', 'products', 'tech_ai', 'financials', 'leadership', 'regulatory', 'ma_partnerships', 'brand', 'talent', 'risk'];
interface SumOut { items: { i: number; about: boolean; ai_related: boolean; dimension?: string; summary?: string }[] }
const SUM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    i: { type: 'integer' }, about: { type: 'boolean' }, ai_related: { type: 'boolean' },
    dimension: { type: 'string', enum: DIMENSIONS }, summary: { type: 'string' },
  }, required: ['i', 'about', 'ai_related', 'dimension', 'summary'] } } },
  required: ['items'],
};
async function selfSummarize() {
  const self = await selfRow();
  const todo = await q<{ id: string; source: string; title: string; published_date: string | null; ai_passages: string[]; text_excerpt: string | null; summary: string | null }>(
    `select id, source, title, published_date::text, ai_passages, text_excerpt, summary from self_record
      where company_slug = $1 and dimension is null order by published_date nulls last`, [self.slug]);
  console.log(`self-summarize: ${todo.length} records`);
  if (DRY || !todo.length) return;
  const batches: typeof todo[] = [];
  for (let i = 0; i < todo.length; i += 12) batches.push(todo.slice(i, i + 12));
  const system = `You file public documents about one company, ${self.name}, for a research record. For each numbered document decide:
about: true only if the document is actually about ${self.name} (not a same-named arena, a different firm, or a passing mention in a list).
ai_related: true if it concerns artificial intelligence, machine learning, data science, models, or AI governance at ${self.name}.
dimension: the single best of ${DIMENSIONS.join(', ')}.
summary: one or two plain factual sentences stating what the document says, drawn only from the text given. No speculation, no praise, no em dashes.
Return every index exactly once.`;
  let done = 0;
  await pool(batches.slice(0, LIMIT), CONCURRENCY, async (b) => {
    await assertBudget();
    const list = b.map((r, i) => {
      const body = (r.ai_passages?.length ? r.ai_passages.join('\n') : r.text_excerpt ?? '').replace(/\s+/g, ' ').slice(0, 1500);
      return `${i + 1}. [${r.source} · ${r.published_date ?? 'undated'}] ${r.title}\n${body}`;
    }).join('\n\n');
    let out: SumOut;
    try {
      out = await routedStructured<SumOut>({
        model: UTILITY_MODEL, system, user: list, toolName: 'submit_filing', toolDescription: 'File each document.',
        schema: SUM_SCHEMA, maxTokens: 3500, timeoutMs: 90_000, feature: 'self_record_summarize', metadata: { n: b.length },
      });
    } catch (e) { console.warn(`  summarize batch failed: ${(e as Error).message.slice(0, 120)}`); return; }
    const byIdx = new Map((out.items ?? []).map((d) => [Number(d.i), d]));
    for (let i = 0; i < b.length; i++) {
      const d = byIdx.get(i + 1);
      if (!d) continue;
      const r = b[i];
      const filing = r.source.startsWith('sec') || r.source === 'merger' || r.source === 'patent' || r.source === 'paper';
      if (!d.about && !filing) { await exec(`delete from self_record where id = $1`, [r.id]); continue; }
      await exec(
        `update self_record set dimension = $1, ai_related = ai_related or $2, summary = coalesce(summary, $3) where id = $4`,
        [DIMENSIONS.includes(String(d.dimension)) ? d.dimension : 'strategy', Boolean(d.ai_related), core.deDash(String(d.summary ?? '')).slice(0, 700) || null, r.id]);
    }
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${batches.length} batches, spend $${(await spentUsd()).toFixed(3)}`);
  });
  console.log(`self-summarize: ${done} batches`);
}

// ---- synthesis: the AI timeline by year, then the cited profile ----
const TIMELINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { events: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    event_date: { type: 'string', description: 'YYYY-MM-DD' },
    category: { type: 'string', enum: core.TIMELINE_CATEGORIES },
    headline: { type: 'string' }, body: { type: 'string' },
    record_ids: { type: 'array', items: { type: 'string' } },
  }, required: ['event_date', 'category', 'headline', 'body', 'record_ids'] } } },
  required: ['events'],
};
const PUBLIC_ONLY = 'Use ONLY the records given. Every statement must be supported by the records you cite by id. Never infer internal plans, never speculate, never praise; write plain reference prose. Never use an em dash.';

async function selfTimeline() {
  const self = await selfRow();
  const years = ['2022', '2023', '2024', '2025', '2026'];
  const all: TimelineEvent[] = [];
  for (const y of years) {
    // Every AI record except patents (spread evenly across the year when there
    // are more than 140), plus an even sample of the year's AI patents and
    // their count by quarter. Patents are a thousand-row stream; taking the
    // first 160 rows by date let them crowd out everything after spring.
    type Rec = { id: string; source: string; title: string; published_date: string; summary: string | null; ai_passages: string[] };
    const spread = <T,>(xs: T[], n: number): T[] => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));
    const range = [self.slug, `${y}-01-01`, `${y}-12-31`];
    const docs = await q<Rec>(`select id, source, title, published_date::text, summary, ai_passages from self_record
        where company_slug = $1 and ai_related and source <> 'patent' and published_date between $2::date and $3::date
        order by published_date`, range);
    const pats = await q<Rec>(`select id, source, title, published_date::text, summary, ai_passages from self_record
        where company_slug = $1 and ai_related and source = 'patent' and published_date between $2::date and $3::date
        order by published_date`, range);
    const recs = [...spread(docs, 140), ...spread(pats, 24)].sort((a, b) => a.published_date.localeCompare(b.published_date));
    const perQuarter = pats.reduce<Record<string, number>>((m, p) => {
      const qk = `Q${Math.floor((Number(p.published_date.slice(5, 7)) - 1) / 3) + 1}`;
      m[qk] = (m[qk] ?? 0) + 1; return m;
    }, {});
    const patentLine = pats.length ? `AI PATENTS GRANTED IN ${y}: ${pats.length} (${Object.entries(perQuarter).map(([k, v]) => `${k} ${v}`).join(', ')}); a sample is listed below. Give the patent stream at most two of your events (never one per patent); every other event comes from the non-patent records.\n` : '';
    console.log(`self-timeline ${y}: ${recs.length} AI records`);
    if (DRY || !recs.length) continue;
    await assertBudget();
    const known = new Set(recs.map((r) => r.id));
    const list = recs.map((r) => `id=${r.id} [${r.published_date} · ${r.source}] ${r.title}\n  ${(r.summary ?? r.ai_passages?.[0] ?? '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
    const out = await routedStructured<{ events: TimelineEventIn[] }>({
      model: SYNTH_MODEL,
      system: `You write the dated timeline of ${self.name}'s public AI moves in ${y}: launches, public statements, hires and leadership roles, papers, partnerships, regulatory events, acquisitions, investments, and the patent stream. Merge records about the same event into one entry citing all of them. Skip routine boilerplate (risk-factor language repeated each quarter) unless it changed. 8 to 25 events spread across the whole year, dated by the event itself. ${PUBLIC_ONLY}`,
      user: `${patentLine}RECORDS (${y}):\n${list}`,
      toolName: 'submit_timeline', toolDescription: 'The year\'s AI timeline.', schema: TIMELINE_SCHEMA,
      maxTokens: 8000, timeoutMs: 180_000, feature: 'self_record_timeline', metadata: { year: y, records: recs.length },
    });
    let events = core.validateTimeline(out.events ?? [], known);
    if (events.length < 6 && docs.length >= 20) {
      // A thin year from a rich record set is a misread instruction, not a quiet year: ask once more.
      const again = await routedStructured<{ events: TimelineEventIn[] }>({
        model: SYNTH_MODEL,
        system: `You write the dated timeline of ${self.name}'s public AI moves in ${y}. Write 12 to 25 events spread across the whole year from the non-patent records (launches, statements, hires, papers, partnerships, regulatory events, acquisitions, investments), plus at most two events summarizing the patent stream. ${PUBLIC_ONLY}`,
        user: `${patentLine}RECORDS (${y}):\n${list}`,
        toolName: 'submit_timeline', toolDescription: 'The year\'s AI timeline.', schema: TIMELINE_SCHEMA,
        maxTokens: 8000, timeoutMs: 180_000, feature: 'self_record_timeline', metadata: { year: y, records: recs.length, retry: true },
      });
      const second = core.validateTimeline(again.events ?? [], known);
      if (second.length > events.length) events = second;
    }
    console.log(`  ${events.length} events kept of ${(out.events ?? []).length}`);
    all.push(...events);
  }
  if (DRY) return;
  if (!all.length) throw new StopError('no timeline events survived the citation gate');
  await exec(`delete from self_timeline where company_slug = $1`, [self.slug]);
  for (const e of all) {
    await exec(`insert into self_timeline (company_slug, event_date, category, headline, body, record_ids) values ($1, $2::date, $3, $4, $5, $6::uuid[])`,
      [self.slug, e.event_date, e.category, e.headline, e.body, e.record_ids]);
  }
  await markUnit('self-timeline', 'self-synthesis', 'done', { items: all.length });
  console.log(`self-timeline: ${all.length} events written`);
}

async function selfProfile() {
  const self = await selfRow();
  const events = await q<{ event_date: string; category: string; headline: string; body: string | null; record_ids: string[] }>(
    `select event_date::text, category, headline, body, record_ids::text[] from self_timeline where company_slug = $1 order by event_date`, [self.slug]);
  const tenK = await q<{ id: string; title: string; ai_passages: string[] }>(
    `select id, title, ai_passages from self_record where company_slug = $1 and source = 'sec_filing' and title like '10-K%' and ai_related
      order by published_date desc limit 1`, [self.slug]);
  const counts = await q<{ source: string; n: number; ai: number }>(
    `select source, count(*)::int n, count(*) filter (where ai_related)::int ai from self_record where company_slug = $1 group by 1`, [self.slug]);
  console.log(`self-profile: ${events.length} timeline events, latest 10-K ${tenK.length ? 'found' : 'missing'}`);
  if (DRY || !events.length) return;
  await assertBudget();
  const known = new Set<string>([...events.flatMap((e) => e.record_ids), ...tenK.map((t) => t.id)]);
  const user = [
    'TIMELINE:',
    ...events.map((e) => `[${e.event_date} · ${e.category}] ${e.headline}. ${e.body ?? ''} (records: ${e.record_ids.join(', ')})`),
    '',
    ...(tenK.length ? [`LATEST ANNUAL REPORT, AI PASSAGES (record ${tenK[0].id}):`, ...tenK[0].ai_passages.slice(0, 6).map((p) => `- ${p.slice(0, 700)}`)] : []),
    '',
    `RECORD COUNTS: ${counts.map((c) => `${c.source} ${c.n} (${c.ai} AI)`).join(', ')}`,
  ].join('\n');
  const out = await routedStructured<{ sentences: unknown[] }>({
    model: SYNTH_MODEL,
    system: `You write a cited public profile of ${self.name}'s AI work since November 2022 for a research agent that writes about banking and AI: what it has built and shipped, how it describes AI in its filings, its research and patents, its partnerships and talent, and its regulatory context. 8 to 15 sentences, each a self-contained factual statement with the record ids that support it. ${PUBLIC_ONLY}`,
    user,
    toolName: 'submit_profile', toolDescription: 'The cited profile.',
    schema: { type: 'object', additionalProperties: false, properties: { sentences: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      text: { type: 'string' }, record_ids: { type: 'array', items: { type: 'string' } } }, required: ['text', 'record_ids'] } } }, required: ['sentences'] },
    maxTokens: 4000, timeoutMs: 180_000, feature: 'self_record_profile', metadata: { events: events.length },
  });
  const sentences = core.validateProfile(out.sentences, known);
  if (sentences.length < 4) throw new StopError(`profile too thin after the citation gate (${sentences.length} sentences)`);
  await exec(`update intel_companies set public_profile = $1 where slug = $2`,
    [JSON.stringify({ sentences, built_at: new Date().toISOString(), model: SYNTH_MODEL }), self.slug]);
  await markUnit('self-profile', 'self-synthesis', 'done', { items: sentences.length });
  console.log(`self-profile: ${sentences.length} sentences saved`);
}

// ------------------------------------------------------------------ main
const PHASES: Record<string, () => Promise<void>> = {
  status, probe, collect, triage, landmarks, draft,
  'self-sec': selfSec, 'self-news': selfNews, 'self-research': selfResearch, 'self-patents': selfPatents,
  'self-regulatory': selfRegulatory, 'self-summarize': selfSummarize, 'self-timeline': selfTimeline, 'self-profile': selfProfile,
};
try {
  const fn = PHASES[phase];
  if (!fn) { console.error(`unknown phase '${phase}'. Phases: ${Object.keys(PHASES).join(', ')}`); process.exitCode = 1; }
  else await fn();
} catch (e) {
  if (e instanceof StopError) { console.error(`STOP: ${e.message}`); process.exitCode = 2; }
  else throw e;
} finally {
  const g = globalThis as { __atlasPool?: { end(): Promise<void> } };
  await g.__atlasPool?.end().catch(() => {});
}

export {};

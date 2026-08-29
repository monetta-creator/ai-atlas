import type { SignalLens } from '../types';
// Explicit .ts extension so plain Node (scripts/test-pipeline2.mjs, type
// stripping) can load this module chain; the bundler resolves it the same.
import { SIGNAL_LENS_SLUGS } from '../format.ts';

// Spike-derived: ~3 web searches ≈ 46s — 77% of the Hobby 60s cap with no margin for
// latency variance, which is exactly what tipped batches over and got them 504'd. We run
// at most 2 searches per discovery invocation (~30s) for real headroom, paired with the
// in-code 50s client timeout (web.ts) so a slow call aborts cleanly instead of dying as an
// opaque platform timeout. Query-heavy lenses split into more (but safer) batches.
export const QUERIES_PER_BATCH = 2;
export const MAX_SEARCH_USES = 2;

// Lens-specific search queries (curated from SPEC-discovery-pipeline.md). The "since
// <date>" recency window is injected by the prompt, not baked into the query strings.
// {year} and {month} resolve at run time from the run's lookback window — hardcoding a
// year silently went stale every January, and a bare year made queries EVERGREEN: web
// search matched the SEO listicles titled with those exact phrases instead of the week's
// news (the July 2026 Kimi K3 miss). {month} pulls results toward current coverage.
const LENS_QUERIES: Record<SignalLens, string[]> = {
  market: [
    'AI hyperscaler capex guidance analyst estimate revision {year}',
    'AI infrastructure power cooling networking memory data center earnings {year}',
    'AI startup funding round valuation down-round flat-round {year}',
    'enterprise software AI revenue attach rate ARR bookings {year}',
    'AI GPU compute spot price H100 H200 rental market {year}',
    'venture capital AI mega-round unicorn write-down {year}',
  ],
  labor: [
    'AI job displacement white collar knowledge worker study data {year}',
    'AI enterprise workforce reduction headcount automation {year}',
    'AI productivity measurement worker output study {year}',
    'AI pilot to production deployment renewal enterprise ROI {year}',
    'AI wage premium skill demand hiring shift {year}',
  ],
  geopolitics: [
    'BIS export control AI chip H20 ruling enforcement {year}',
    'China AI model release DeepSeek Qwen Kimi Moonshot Huawei Ascend {month} {year}',
    'TSMC CoWoS advanced packaging capacity allocation {year}',
    'US China semiconductor supply chain restriction {year}',
    'sovereign AI national strategy compute investment {year}',
    'AI military autonomous weapons dual use deployment {year}',
  ],
  regulatory: [
    'EU AI Act enforcement high-risk system compliance deadline {year}',
    'OCC FDIC Fed SEC CFPB FINRA AI model risk guidance {year}',
    'US federal preemption state AI law Colorado Texas California {year}',
    'AI copyright IP training data lawsuit ruling {year}',
    'AI financial services algorithmic bias fair lending {year}',
  ],
  capability: [
    // News-shaped, month-anchored queries first: a frontier release is the single most
    // material capability event and the old evergreen phrasing never surfaced one.
    'new frontier AI model release announcement {month} {year}',
    'Chinese AI lab model release Kimi Moonshot Qwen GLM MiniMax {month} {year}',
    'open source open weight AI model release benchmark {month} {year}',
    'AI model benchmark evaluation contamination {year}',
    'agentic AI autonomous deployment production reliability {year}',
    'AI inference cost per token falling trend {year}',
    'AI training efficiency compute requirement reduction {year}',
    'AI safety alignment red team evaluation research {year}',
    'AI hardware bottleneck HBM memory supply chain {year}',
  ],
  society: [
    'AI public opinion survey anxiety trust attitude {year}',
    'AI worker sentiment fear job meaning {year}',
    'AI cultural narrative film media portrayal {year}',
    'AI misinformation deepfake synthetic content harm {year}',
    'AI university college academic integrity policy {year}',
    'AI creative industry art music writing economic impact {year}',
    'AI think tank CSET Stanford HAI Brookings RAND report {year}',
  ],
};

export const ALL_LENSES: SignalLens[] = SIGNAL_LENS_SLUGS;
// The high-cadence lenses a daily run sweeps. The spec's "anything flagged as breaking"
// is now the breaking-events sweep below (discoverBreakingSweep) — every run gets it.
export const DAILY_LENSES: SignalLens[] = ['market', 'capability'];

// ---- Breaking-events sweep --------------------------------------------------
// One lens-agnostic, significance-first discovery unit per run. The thematic lens
// queries above find what they literally name; this batch instead asks "what did the
// serious press report since the window opened" over a curated quality-outlet
// allowlist (the inverse of the blocklist strategy — web_search accepts allowed_domains
// OR blocked_domains, not both). Born from the Kimi K3 miss: Bloomberg/CNBC/TechCrunch
// all carried it for three days and no lens query surfaced any of them.
export const SWEEP_QUERIES: string[] = [
  'most significant AI developments news {month} {year}',
  'major AI model release announcement {month} {year}',
];
// CONSTRAINT (live-tested 2026-07-19): every entry must be crawlable by Anthropic's
// search agent or the API 400s the WHOLE call. reuters.com, apnews.com, nytimes.com,
// wsj.com, ft.com, economist.com, theverge.com and arstechnica.com all block the
// crawler and are therefore unusable here.
export const BREAKING_SWEEP_DOMAINS: string[] = [
  'bloomberg.com', 'cnbc.com', 'washingtonpost.com', 'fortune.com', 'techcrunch.com',
  'venturebeat.com', 'axios.com', 'theinformation.com', 'semianalysis.com',
  'tomshardware.com', 'technologyreview.com', 'theregister.com', 'scmp.com',
];

// Independent phrasing for the post-run coverage check (lib/pipeline/coverage.ts). If it
// reused SWEEP_QUERIES verbatim it would mostly re-find what the sweep just inserted and
// rubber-stamp the run; a different angle makes it a real check.
export const COVERAGE_QUERIES: string[] = [
  'biggest AI news this week {month} {year}',
  'most important AI announcements {month} {year}',
];

// ---- Learning-loop guardrails ----------------------------------------------
// Domains the zero-yield auto-blocklist (getZeroYieldDomains) may NEVER block, no matter
// their funnel record: primary-source infrastructure and major wires. The behavioral
// blocklist once swallowed occ.gov (five of six candidates were DUPLICATES — the domain
// yields real stories we already track) and had huggingface.co qualified for blocking on
// five rejected community-blog posts, which would have hidden the platform where every
// open-weight release actually lands. Curated LOW_QUALITY_DOMAINS is human judgment and
// is not filtered through this.
const NEVER_AUTO_BLOCK_DOMAINS: string[] = [
  'arxiv.org', 'huggingface.co', 'github.com', 'reuters.com', 'apnews.com',
  'bloomberg.com', 'ft.com', 'wsj.com', 'nytimes.com', 'economist.com',
  'oecd.org', 'imf.org', 'worldbank.org', 'bis.org', 'nber.org', 'ssrn.com',
  'europa.eu',
];
const NEVER_AUTO_BLOCK_SUFFIXES = ['.gov', '.mil', '.edu', '.gov.uk', '.europa.eu'];
export function isNeverAutoBlocked(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return (
    NEVER_AUTO_BLOCK_DOMAINS.includes(d) ||
    NEVER_AUTO_BLOCK_SUFFIXES.some((s) => d.endsWith(s))
  );
}

// Known low-signal source categories triage should reject. Not exhaustive — the triage
// prompt also applies descriptive judgment (primary sources + serious analysis only).
export const LOW_QUALITY_DOMAINS: string[] = [
  'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'einpresswire.com',
  'accesswire.com', 'newswire.com', 'prweb.com', 'medium.com', 'substack.com',
  'seekingalpha.com', 'fool.com', 'benzinga.com', 'zacks.com', 'investorplace.com',
  'aicerts.ai', 'analyticsinsight.net', 'marktechpost.com',
];

// Split a lens's queries into <=QUERIES_PER_BATCH chunks (one discovery invocation each).
function batchQueries(queries: string[], size = QUERIES_PER_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += size) out.push(queries.slice(i, i + size));
  return out;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Resolve {year}/{month} in query templates from the run's window start (UTC, so the
// resolution is deterministic per run — a resumed batch days later gets the same query
// text as its siblings). Falls back to "now" when no/invalid date is given (callers that
// only need the batch COUNT).
export function resolveDateTokens(queries: string[], sinceISO?: string): string[] {
  let d = sinceISO ? new Date(`${sinceISO}T00:00:00Z`) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  const year = String(d.getUTCFullYear());
  const month = MONTH_NAMES[d.getUTCMonth()];
  return queries.map((q) => q.replaceAll('{year}', year).replaceAll('{month}', month));
}

// Lens -> the ordered list of query batches a run will execute for it. The window date
// defaults to "now" for callers that only need the batch COUNT (discoveryPlan);
// discoverBatch passes the run's sinceISO so the query text matches the lookback.
export function lensBatches(lens: SignalLens, sinceISO?: string): string[][] {
  return batchQueries(resolveDateTokens(LENS_QUERIES[lens] ?? [], sinceISO));
}

// ---- Pipeline 2.0: daily rotation + the utility judge --------------------
// The cheap model that runs the pipeline's guarded-judgment calls (triage,
// the sweep judge, the coverage judge) when OPENROUTER_API_KEY is set and
// pipeline_prefs.utility_model is null. Chosen from the live scan A/B:
// 14/14 clean structured outputs, 1.8s avg, ~$0.0001/call.
export const DEFAULT_UTILITY_MODEL = 'qwen/qwen3.7-flash';

// Deterministic day-rotation over a query list: day N serves `count` queries
// starting at (N*count mod len), wrapping. Daily runs cover a lens's whole
// list every ceil(len/count) days at a fraction of the per-day search spend;
// consecutive days never repeat until the list wraps. Pure; test-covered.
export function rotatedQueries(queries: string[], dayISO: string, count = 2): string[] {
  if (queries.length <= count) return queries;
  const day = Math.floor(Date.parse(`${dayISO}T00:00:00Z`) / 86_400_000);
  const start = ((Number.isFinite(day) ? day : 0) * count) % queries.length;
  return Array.from({ length: count }, (_, i) => queries[(start + i) % queries.length]);
}

// The rotated daily slice for one lens (date tokens resolved like lensBatches).
export function dailyLensQueries(lens: SignalLens, dayISO: string): string[] {
  return resolveDateTokens(rotatedQueries(LENS_QUERIES[lens] ?? [], dayISO), dayISO);
}

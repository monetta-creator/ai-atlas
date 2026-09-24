// Ask retrieval A/B runner: FTS vs hybrid over the 40-question gold set at
// private/ask-gold/questions.json. Wires the real buildAskContext (unlike
// scripts/ab-retrieval.mjs, whose retrieve() stub throws) by running under
// tsx, which resolves the app's '@/*' path alias and extensionless lib
// imports that plain Node's type stripping cannot. Writes
// private/ask-gold/last-run.md and prints the summary tables.
//
// Usage: npx -y tsx scripts/ab-retrieval-run.mts [--limit=N]
//
// Env: reads SUPABASE_DB_PASSWORD from .env.local and builds a transaction-
// pooler DATABASE_URL (the direct db.<ref>.supabase.co host is IPv6-only and
// unreachable from most local networks the same way it is from Vercel).
// DB_POOL_MAX=1 keeps this one-shot script to a single pooled connection.

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GOLD_PATH = path.join(REPO_ROOT, 'private/ask-gold/questions.json');
const REPORT_PATH = path.join(REPO_ROOT, 'private/ask-gold/last-run.md');

const PROJECT_REF = 'wuyxchwgasjefbswpxvm';
const POOLER_HOST = 'aws-1-us-east-2.pooler.supabase.com';

function buildDatabaseUrl(): string {
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) {
    console.error('SUPABASE_DB_PASSWORD not set (expected in .env.local).');
    process.exit(1);
  }
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:6543/postgres`;
}

process.env.DATABASE_URL = buildDatabaseUrl();
process.env.DB_POOL_MAX = '1';

// Dynamic imports AFTER the env vars above are set, so lib/db's lazy pool
// (created on first query, not at import time) picks up the pooler URL.
const { buildAskContext } = await import('../lib/ask/retrieve.ts');
const { decideLane } = await import('../lib/ask/lanes.ts');
const { one } = await import('../lib/db.ts');

// --------------------------------------------------------------- arg parsing
function parseArgs(argv: string[]) {
  const args: { limit: number | null } = { limit: null };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

// ----------------------------------------------------------------- gold set
interface ExpectedKey { kind: string; key: string }
interface GoldQuestion {
  id: string;
  question: string;
  expected: ExpectedKey[];
  lane: 'covered' | 'thin' | 'adjacent' | 'unrelated';
  audience: 'guest' | 'portal' | 'admin';
  notes: string;
}

function categoryOf(id: string): string {
  const prefix = id.replace(/[0-9].*$/, '');
  const NAMES: Record<string, string> = {
    d: 'direct', p: 'paraphrase', i: 'intel', t: 'thin_adjacent', u: 'unrelated', f: 'followup',
  };
  return NAMES[prefix] || 'other';
}

// The gold lane maps onto decideLane's `beat` input directly: covered/thin
// questions are on the Atlas's own beat, adjacent stays adjacent, unrelated
// stays unrelated. This is an approximation of the real classifier (which
// reads the question's phrasing, not its gold label) done because a live
// classify() call per question/mode roughly doubles the model spend of this
// run for a signal the plan says is optional ("use the real classifier only
// if it is cheap; otherwise pass beat = the gold lane's beat equivalent").
// Noted again in the report footer.
function beatFromGoldLane(lane: GoldQuestion['lane']): 'atlas' | 'adjacent' | 'unrelated' {
  if (lane === 'covered' || lane === 'thin') return 'atlas';
  return lane;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function fmtPct(x: number | null): string {
  return x === null ? '-' : `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number | null, digits = 3): string {
  return x === null ? '-' : x.toFixed(digits);
}

// ------------------------------------------------------------------ scoring
function sameKey(exp: ExpectedKey, hits: ExpectedKey[]): boolean {
  return hits.some((h) => h.kind === exp.kind && h.key === exp.key);
}

function recallForQuestion(expected: ExpectedKey[], hits: ExpectedKey[]): number | null {
  if (!expected.length) return null; // no-target row, not scored for recall
  const top10 = hits.slice(0, 10);
  let hit = 0;
  for (const exp of expected) {
    if (sameKey(exp, top10)) hit += 1;
  }
  return hit / expected.length;
}

interface RunRow {
  id: string;
  category: string;
  question: string;
  goldLane: string;
  audience: string;
  expected: ExpectedKey[];
  expectedCount: number;
  hitCount: number;
  recall: number | null;
  foundKeys: string[];
  missingKeys: string[];
  maxRank: number;
  maxSim: number;
  decidedLane: string;
  laneAgree: boolean;
  error: string | null;
}

async function runMode(questions: GoldQuestion[], mode: 'fts' | 'hybrid'): Promise<RunRow[]> {
  const rows: RunRow[] = [];
  for (const gq of questions) {
    process.env.ASK_RETRIEVAL_OVERRIDE = mode;
    let hits: ExpectedKey[] = [];
    let maxRank = 0;
    let maxSim = 0;
    let error: string | null = null;
    let explicit = false;
    try {
      const askMode = gq.audience === 'admin' ? 'admin' : 'portal';
      const ctx = await buildAskContext(gq.question, { mode: askMode });
      hits = ctx.retrievedKeys;
      maxRank = ctx.maxRank;
      maxSim = ctx.maxSim;
      explicit = ctx.explicit;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const recall = error ? null : recallForQuestion(gq.expected, hits);
    const beat = beatFromGoldLane(gq.lane);
    const followUp = gq.id.startsWith('f');
    const decidedLane = error
      ? 'error'
      : decideLane({ hitCount: hits.length, maxRank, maxSim, explicit, beat, followUp });
    const foundKeys = gq.expected.filter((exp) => sameKey(exp, hits.slice(0, 10))).map((e) => `${e.kind}:${e.key}`);
    const missingKeys = gq.expected.filter((exp) => !sameKey(exp, hits.slice(0, 10))).map((e) => `${e.kind}:${e.key}`);
    rows.push({
      id: gq.id,
      category: categoryOf(gq.id),
      question: gq.question,
      goldLane: gq.lane,
      audience: gq.audience,
      expected: gq.expected,
      expectedCount: gq.expected.length,
      hitCount: hits.length,
      recall,
      foundKeys,
      missingKeys,
      maxRank,
      maxSim,
      decidedLane,
      laneAgree: decidedLane === gq.lane,
      error,
    });
  }
  delete process.env.ASK_RETRIEVAL_OVERRIDE;
  return rows;
}

function summarize(rows: RunRow[]) {
  const scored = rows.filter((r) => r.recall !== null);
  const overallRecall = mean(scored.map((r) => r.recall as number));
  const byCategory: Record<string, { n: number; recall: number | null }> = {};
  for (const cat of ['direct', 'paraphrase', 'intel', 'thin_adjacent', 'unrelated', 'followup']) {
    const catRows = scored.filter((r) => r.category === cat);
    byCategory[cat] = { n: catRows.length, recall: mean(catRows.map((r) => r.recall as number)) };
  }
  const laneAgreeRate = mean(rows.filter((r) => r.decidedLane !== 'error').map((r) => (r.laneAgree ? 1 : 0)));
  const errorCount = rows.filter((r) => r.error).length;
  return { rows, overallRecall, byCategory, laneAgreeRate, errorCount, n: rows.length, scoredN: scored.length };
}

// -------------------------------------------------------------- maxSim bars
// Buckets rows by the gold lane's "coverage-ness" (covered vs thin/adjacent
// vs unrelated) and reports the maxSim distribution in each, so a bar can be
// picked the way STRONG_RANK/MID_RANK/WEAK_RANK were picked for maxRank: by
// measurement, not assumption (lib/ask/lanes.ts's own comment on that
// history). Finds the maxSim threshold that best separates "covered" from
// "unrelated" rows (fewest misclassifications) by scanning candidate cut
// points between consecutive distinct values.
function simStats(xs: number[]) {
  if (!xs.length) return { n: 0, min: null, max: null, mean: null, values: [] as number[] };
  const sorted = [...xs].sort((a, b) => a - b);
  return { n: xs.length, min: sorted[0], max: sorted[sorted.length - 1], mean: mean(xs), values: sorted };
}

function bestSimBar(coveredSims: number[], unrelatedSims: number[]): { bar: number | null; misclassified: number } {
  const all = [...new Set([...coveredSims, ...unrelatedSims])].sort((a, b) => a - b);
  if (!all.length) return { bar: null, misclassified: 0 };
  let best = { bar: all[0], misclassified: Infinity };
  const candidates = [all[0] - 0.01, ...all.map((v, i) => (i === 0 ? v : (v + all[i - 1]) / 2)), all[all.length - 1] + 0.01];
  for (const bar of candidates) {
    const falsePos = unrelatedSims.filter((s) => s >= bar).length; // unrelated wrongly called covered
    const falseNeg = coveredSims.filter((s) => s < bar).length; // covered wrongly called not-covered
    const miscls = falsePos + falseNeg;
    if (miscls < best.misclassified) best = { bar, misclassified: miscls };
  }
  return best;
}

// -------------------------------------------------------------- report.md
function toMarkdown(byMode: Record<'fts' | 'hybrid', ReturnType<typeof summarize>>): string {
  const lines: string[] = [];
  lines.push('# Ask retrieval A/B: FTS vs hybrid, 40-question gold set');
  lines.push('');
  lines.push(`Run at ${new Date().toISOString()}.`);
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push('| mode | n | scored | errors | recall@10 | lane agreement |');
  lines.push('|---|---|---|---|---|---|');
  for (const mode of ['fts', 'hybrid'] as const) {
    const s = byMode[mode];
    lines.push(`| ${mode} | ${s.n} | ${s.scoredN} | ${s.errorCount} | ${fmtPct(s.overallRecall)} | ${fmtPct(s.laneAgreeRate)} |`);
  }
  lines.push('');
  lines.push('## Per-category recall@10, FTS vs hybrid');
  lines.push('');
  lines.push('| category | n | FTS recall@10 | hybrid recall@10 | delta |');
  lines.push('|---|---|---|---|---|');
  for (const cat of ['direct', 'paraphrase', 'intel', 'thin_adjacent', 'unrelated', 'followup']) {
    const f = byMode.fts.byCategory[cat];
    const h = byMode.hybrid.byCategory[cat];
    const delta = f.recall !== null && h.recall !== null ? `${((h.recall - f.recall) * 100).toFixed(1)}pp` : '-';
    lines.push(`| ${cat} | ${f.n} | ${fmtPct(f.recall)} | ${fmtPct(h.recall)} | ${delta} |`);
  }
  lines.push('');

  // maxSim distribution by gold-lane bucket, both modes report the same
  // maxSim (it is always computed regardless of ASK_RETRIEVAL_OVERRIDE), so
  // use the fts-mode run's rows (identical maxSim values in hybrid mode).
  lines.push('## maxSim distribution by lane bucket (fts-mode run; maxSim is computed in both modes identically)');
  lines.push('');
  lines.push('| bucket | n | min | mean | max |');
  lines.push('|---|---|---|---|---|');
  const ftsRows = byMode.fts.rows.filter((r) => !r.error);
  const buckets: Record<string, RunRow[]> = {
    covered: ftsRows.filter((r) => r.goldLane === 'covered'),
    thin_adjacent: ftsRows.filter((r) => r.goldLane === 'thin' || r.goldLane === 'adjacent'),
    unrelated: ftsRows.filter((r) => r.goldLane === 'unrelated'),
  };
  for (const [name, bucketRows] of Object.entries(buckets)) {
    const stats = simStats(bucketRows.map((r) => r.maxSim));
    lines.push(`| ${name} | ${stats.n} | ${fmtNum(stats.min)} | ${fmtNum(stats.mean)} | ${fmtNum(stats.max)} |`);
  }
  const coveredSims = buckets.covered.map((r) => r.maxSim);
  const unrelatedSims = buckets.unrelated.map((r) => r.maxSim);
  const bar = bestSimBar(coveredSims, unrelatedSims);
  lines.push('');
  lines.push(`**Recommended maxSim bar (covered vs unrelated, fewest misclassifications): ${fmtNum(bar.bar)}** (${bar.misclassified} misclassified out of ${coveredSims.length + unrelatedSims.length} covered+unrelated rows)`);
  lines.push('');

  // Hybrid regressions: covered questions where hybrid's recall dropped
  // below fts's.
  lines.push('## Questions where hybrid made a covered question worse');
  lines.push('');
  const ftsById = new Map(byMode.fts.rows.map((r) => [r.id, r]));
  const regressions = byMode.hybrid.rows.filter((h) => {
    if (h.goldLane !== 'covered') return false;
    const f = ftsById.get(h.id);
    if (!f || f.recall === null || h.recall === null) return false;
    return h.recall < f.recall;
  });
  if (!regressions.length) {
    lines.push('None: no covered question scored a lower recall@10 under hybrid than under FTS.');
  } else {
    lines.push('| id | question | FTS recall | hybrid recall |');
    lines.push('|---|---|---|---|');
    for (const r of regressions) {
      const f = ftsById.get(r.id)!;
      lines.push(`| ${r.id} | ${r.question.replace(/\|/g, '/')} | ${fmtPct(f.recall)} | ${fmtPct(r.recall)} |`);
    }
  }
  lines.push('');

  // Per-question detail, one table per mode.
  for (const mode of ['fts', 'hybrid'] as const) {
    lines.push(`## Per-question detail, mode=${mode}`);
    lines.push('');
    lines.push('| id | category | gold lane | decided lane | recall@10 | found | missing | maxRank | maxSim | error |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of byMode[mode].rows) {
      lines.push(
        `| ${r.id} | ${r.category} | ${r.goldLane} | ${r.decidedLane} | ${r.recall === null ? '-' : fmtPct(r.recall)} | ${r.foundKeys.join(', ') || '-'} | ${r.missingKeys.join(', ') || '-'} | ${fmtNum(r.maxRank, 4)} | ${fmtNum(r.maxSim, 4)} | ${r.error ? r.error.replace(/\|/g, '/').slice(0, 120) : ''} |`
      );
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- `decided lane` uses lib/ask/lanes.ts decideLane with the classifier beat INFERRED from the gold lane (covered/thin -> atlas, adjacent -> adjacent, unrelated -> unrelated), not a live classify() call, to keep this run cheap. Treat lane-agreement numbers as a lower bound on what the real classifier would produce, since the real classifier reads the question wording rather than the gold label.');
  lines.push('- recall@10 counts the first 10 distinct records in AskContext.retrievedKeys (ranked, post-fusion order for hybrid), matched against the gold `expected` list by exact {kind, key}.');
  lines.push('- Rows with an empty `expected[]` (unrelated/adjacent, no plausible target) are excluded from recall@10 (no-target rows), consistent with scripts/ab-retrieval.mjs.');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));

  let gold: { questions: GoldQuestion[] };
  try {
    gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  } catch (e) {
    console.error(`Could not read gold set at ${GOLD_PATH}: ${(e as Error).message}`);
    process.exit(1);
  }

  let questions = gold.questions;
  if (args.limit) questions = questions.slice(0, args.limit);

  // Sanity ping the DB before burning any embedding calls.
  await one('select 1 as ok');

  console.log(`Running ${questions.length} question(s) x 2 modes (fts, hybrid)...`);
  const ftsRows = await runMode(questions, 'fts');
  console.log('fts done.');
  const hybridRows = await runMode(questions, 'hybrid');
  console.log('hybrid done.');

  const byMode = { fts: summarize(ftsRows), hybrid: summarize(hybridRows) };
  const md = toMarkdown(byMode);

  console.log('');
  console.log(md);

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, md);
  console.log(`\nWrote ${REPORT_PATH}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

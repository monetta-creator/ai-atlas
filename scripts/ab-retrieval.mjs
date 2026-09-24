// A/B harness for Ask retrieval quality (FTS vs a future hybrid/embeddings
// mode), scored against the hand-built gold set at private/ask-gold/questions.json
// (untracked, maintainer-only; see that file's _meta for how it was built).
//
// The one thing this script does NOT do yet is call real retrieval: `retrieve`
// below is a single pluggable async function that currently throws. Wiring it
// to lib/ask/retrieve.ts (or an HTTP probe route once one exists) is future
// work; everything else here — loading the gold set, running it through
// `retrieve`, scoring recall@10 overall/per-category/per-lane, and writing the
// markdown report — is complete and self-testable without a live retrieval
// backend via --self-test.
//
// Usage:
//   node scripts/ab-retrieval.mjs --mode=fts [--limit=N]
//   node scripts/ab-retrieval.mjs --mode=hybrid
//   node scripts/ab-retrieval.mjs --self-test
//
// Flags:
//   --mode=fts|hybrid   which retrieval mode to score (default fts)
//   --limit=N           only run the first N gold questions (default: all)
//   --self-test         run the scorer over a built-in fixture and exit;
//                        no DB, no HTTP, no gold-set file needed
//
// Env: loads .env.local via dotenv (BASE, if ever needed by a wired-up
// `retrieve`, defaults to http://localhost:3400).

import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const GOLD_PATH = path.join(REPO_ROOT, 'private/ask-gold/questions.json');
const REPORT_PATH = path.join(REPO_ROOT, 'private/ask-gold/last-run.md');

const BASE = process.env.BASE || 'http://localhost:3400';

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { mode: 'fts', limit: null, selfTest: false };
  for (const arg of argv) {
    if (arg === '--self-test') args.selfTest = true;
    else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length).trim();
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (!args.selfTest && args.mode !== 'fts' && args.mode !== 'hybrid') {
    console.error(`--mode must be 'fts' or 'hybrid', got '${args.mode}'`);
    process.exit(1);
  }
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    console.error('--limit must be a positive number.');
    process.exit(1);
  }
  return args;
}

// ------------------------------------------------------------- retrieve() stub
// Pluggable retrieval call. A real implementation calls into
// lib/ask/retrieve.ts's buildAskContext (directly, if this script grows a
// type-stripped import like scripts/ab-research-triage.mjs's sibling scripts,
// or over HTTP against a probe route such as POST /api/ask/retrieve-probe if
// one is ever added — no such route exists yet). It must resolve to a
// RetrievalResult: an ordered list of { kind, key } hits (top 10 or more; the
// scorer only looks at the first 10) for the given question and mode.
//
// RetrievalResult:
//   { hits: { kind: string, key: string }[] }
//
async function retrieve(question, mode) {
  void question;
  void mode;
  throw new Error('wire me to lib/ask/retrieve.ts');
}

// ------------------------------------------------------------------- scoring
// recall@10 for one question: fraction of its expected {kind,key} pairs that
// appear among the first 10 hits of the same kind. A question with an empty
// expected[] (unrelated/adjacent questions with no plausible target) scores
// 1 when retrieval also returns nothing relevant-looking is NOT checked here
// (that is a precision/decline question, out of scope for recall@10) — those
// rows are excluded from recall denominators and reported separately as
// "no-target" rows.
function sameKey(kind, key, hit) {
  return hit.kind === kind && hit.key === key;
}

function recallForQuestion(expected, hits) {
  if (!expected.length) return null; // no-target row, not scored for recall
  const top10 = hits.slice(0, 10);
  let hit = 0;
  for (const exp of expected) {
    if (top10.some((h) => sameKey(exp.kind, exp.key, h))) hit += 1;
  }
  return hit / expected.length;
}

function categoryOf(id) {
  // Gold-set id prefixes: d=direct, p=paraphrase, i=intel, t=thin/adjacent,
  // u=unrelated, f=followup (private/ask-gold/questions.json's own scheme).
  const prefix = id.replace(/[0-9].*$/, '');
  const NAMES = { d: 'direct', p: 'paraphrase', i: 'intel', t: 'thin_adjacent', u: 'unrelated', f: 'followup' };
  return NAMES[prefix] || 'other';
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function fmtPct(x) {
  return x === null ? '-' : `${(x * 100).toFixed(1)}%`;
}

// Runs the gold set (or a fixture) through `retrieveFn` and returns per-row
// results plus aggregate scoring. Pure with respect to I/O: `retrieveFn` is
// the only side-effecting call, injected so --self-test can pass a fixture
// stub instead of the real `retrieve`.
async function scoreGoldSet(questions, mode, retrieveFn) {
  const rows = [];
  for (const q of questions) {
    let hits = [];
    let error = null;
    try {
      const result = await retrieveFn(q.question, mode);
      hits = result?.hits ?? [];
    } catch (e) {
      error = e.message;
    }
    const recall = error ? null : recallForQuestion(q.expected, hits);
    rows.push({
      id: q.id,
      category: categoryOf(q.id),
      lane: q.lane,
      audience: q.audience,
      question: q.question,
      expectedCount: q.expected.length,
      hitCount: hits.length,
      recall,
      laneAgree: null, // filled in below once we know the mode's reported lane, if any
      reportedLane: hits.lane ?? null,
      error,
    });
  }

  const scored = rows.filter((r) => r.recall !== null);
  const overallRecall = mean(scored.map((r) => r.recall));

  const byCategory = {};
  for (const cat of ['direct', 'paraphrase', 'intel', 'thin_adjacent', 'unrelated', 'followup']) {
    const catRows = scored.filter((r) => r.category === cat);
    byCategory[cat] = { n: catRows.length, recall: mean(catRows.map((r) => r.recall)) };
  }

  const laneAgreement = rows.filter((r) => r.reportedLane !== null);
  const laneAgreeRate = laneAgreement.length
    ? mean(laneAgreement.map((r) => (r.reportedLane === r.lane ? 1 : 0)))
    : null;

  const errors = rows.filter((r) => r.error);

  return { rows, overallRecall, byCategory, laneAgreeRate, errorCount: errors.length, n: rows.length, scoredN: scored.length };
}

// ------------------------------------------------------------------- markdown
function toMarkdown(summary, mode) {
  const lines = [];
  lines.push(`# Ask retrieval A/B: mode=${mode}`);
  lines.push('');
  lines.push(`Run at ${new Date().toISOString()}. ${summary.n} question(s), ${summary.scoredN} scored for recall (excludes no-target rows), ${summary.errorCount} error(s).`);
  lines.push('');
  lines.push(`**Overall recall@10: ${fmtPct(summary.overallRecall)}**`);
  if (summary.laneAgreeRate !== null) {
    lines.push(`**Lane agreement: ${fmtPct(summary.laneAgreeRate)}** (retrieval-reported lane vs gold lane, where a lane was reported)`);
  }
  lines.push('');
  lines.push('## Per-category recall@10');
  lines.push('');
  lines.push('| category | n | recall@10 |');
  lines.push('|---|---|---|');
  for (const [cat, v] of Object.entries(summary.byCategory)) {
    lines.push(`| ${cat} | ${v.n} | ${fmtPct(v.recall)} |`);
  }
  lines.push('');
  lines.push('## Per-question detail');
  lines.push('');
  lines.push('| id | category | lane | recall | expected | hits | error |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of summary.rows) {
    lines.push(`| ${r.id} | ${r.category} | ${r.lane} | ${r.recall === null ? '-' : fmtPct(r.recall)} | ${r.expectedCount} | ${r.hitCount} | ${r.error ? r.error.replace(/\|/g, '/') : ''} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));

  let gold;
  try {
    gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  } catch (e) {
    console.error(`Could not read gold set at ${GOLD_PATH}: ${e.message}`);
    process.exit(1);
  }

  let questions = gold.questions;
  if (args.limit) questions = questions.slice(0, args.limit);

  console.log(`Scoring ${questions.length} question(s) against BASE=${BASE} mode=${args.mode}...`);
  const summary = await scoreGoldSet(questions, args.mode, retrieve);

  const md = toMarkdown(summary, args.mode);
  console.log('');
  console.log(md);

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, md);
  console.log(`\nWrote ${REPORT_PATH}`);

  if (summary.errorCount === questions.length) {
    console.error('\nEvery question errored (retrieve() is unwired). Nothing to score.');
    process.exit(1);
  }
}

// ----------------------------------------------------------------- self-test
// Proves the scoring math without a DB, an HTTP server, or the real gold set:
// a tiny fixture with known right/wrong/partial/no-target rows and asserted
// expected recall numbers.
function runSelfTest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-test assertion failed: ${msg}`);
  };

  const fixtureQuestions = [
    // Perfect hit: single expected key, present in top 10.
    { id: 'd01', expected: [{ kind: 'claim', key: '7.2' }], lane: 'covered' },
    // Miss: expected key absent from returned hits.
    { id: 'd02', expected: [{ kind: 'claim', key: '1.2' }], lane: 'covered' },
    // Partial: two expected keys, one present.
    { id: 'i01', expected: [{ kind: 'intel_fact', key: 'a' }, { kind: 'intel_item', key: 'b' }], lane: 'covered' },
    // No-target row: excluded from recall denominator.
    { id: 'u01', expected: [], lane: 'unrelated' },
    // Beyond-top-10: expected key present but at rank 11, must not count.
    { id: 'p01', expected: [{ kind: 'claim', key: 'x' }], lane: 'covered' },
    // Errors: retrieve() throws.
    { id: 'f01', expected: [{ kind: 'claim', key: 'y' }], lane: 'thin' },
  ];

  const fixtureHits = {
    d01: [{ kind: 'claim', key: '7.2' }, { kind: 'signal', key: 's1' }],
    d02: [{ kind: 'claim', key: '9.9' }],
    i01: [{ kind: 'intel_fact', key: 'a' }, { kind: 'intel_fact', key: 'zzz' }],
    u01: [{ kind: 'claim', key: 'whatever' }],
    p01: Array.from({ length: 11 }, (_, i) => (i === 10 ? { kind: 'claim', key: 'x' } : { kind: 'claim', key: `filler${i}` })),
  };

  // scoreGoldSet calls retrieveFn(question, mode) with only the question TEXT,
  // so the fixture keys hits by a `question` field carrying the row id.
  const idQuestions = fixtureQuestions.map((q) => ({ ...q, question: q.id, audience: 'guest' }));
  const retrieveFn = async (question) => {
    if (question === 'f01') throw new Error('boom');
    return { hits: fixtureHits[question] ?? [] };
  };

  scoreGoldSet(idQuestions, 'fts', retrieveFn).then((summary) => {
    assert(summary.n === 6, `expected 6 rows, got ${summary.n}`);
    assert(summary.scoredN === 4, `expected 4 scored rows (u01 excluded as no-target), got ${summary.scoredN}`);
    // Note: f01 errors, so it is also excluded from scoredN (recall === null).
    assert(summary.errorCount === 1, `expected 1 error, got ${summary.errorCount}`);

    const byId = Object.fromEntries(summary.rows.map((r) => [r.id, r]));
    assert(byId.d01.recall === 1, `d01 should be perfect recall, got ${byId.d01.recall}`);
    assert(byId.d02.recall === 0, `d02 should be zero recall, got ${byId.d02.recall}`);
    assert(byId.i01.recall === 0.5, `i01 should be 0.5 recall (1 of 2), got ${byId.i01.recall}`);
    assert(byId.u01.recall === null, `u01 (no-target) should not be scored, got ${byId.u01.recall}`);
    assert(byId.p01.recall === 0, `p01's expected key at rank 11 must not count within top 10, got ${byId.p01.recall}`);
    assert(byId.f01.recall === null, `f01 errored, should not be scored, got ${byId.f01.recall}`);

    // overall recall over the 4 scored rows: (1 + 0 + 0.5 + 0) / 4 = 0.375
    assert(Math.abs(summary.overallRecall - 0.375) < 1e-9, `expected overall recall 0.375, got ${summary.overallRecall}`);

    const cat = summary.byCategory;
    assert(cat.direct.n === 2 && Math.abs(cat.direct.recall - 0.5) < 1e-9, `direct category should be n=2 recall=0.5, got ${JSON.stringify(cat.direct)}`);
    assert(cat.intel.n === 1 && cat.intel.recall === 0.5, `intel category should be n=1 recall=0.5, got ${JSON.stringify(cat.intel)}`);
    assert(cat.unrelated.n === 0, `unrelated category should have n=0 scored rows (no-target), got ${cat.unrelated.n}`);
    assert(cat.paraphrase.n === 1 && cat.paraphrase.recall === 0, `paraphrase category should be n=1 recall=0, got ${JSON.stringify(cat.paraphrase)}`);
    assert(cat.followup.n === 0, `followup category should have n=0 scored rows (f01 errored), got ${cat.followup.n}`);

    const md = toMarkdown(summary, 'self-test');
    assert(md.includes('Overall recall@10: 37.5%'), 'markdown should render the overall recall percentage');
    assert(md.includes('| direct | 2 | 50.0% |'), 'markdown should render the direct-category row');

    // fmtPct / categoryOf spot checks.
    assert(fmtPct(null) === '-', 'fmtPct(null) should render as a dash');
    assert(fmtPct(1) === '100.0%', 'fmtPct(1) should render as 100.0%');
    assert(categoryOf('t03') === 'thin_adjacent', `categoryOf('t03') should be thin_adjacent, got ${categoryOf('t03')}`);
    assert(categoryOf('zz99') === 'other', `categoryOf('zz99') should fall back to other, got ${categoryOf('zz99')}`);

    console.log('self-test: all assertions passed');
    console.log(md);
  }).catch((e) => {
    console.error(`self-test FAILED: ${e.message}`);
    process.exit(1);
  });
}

if (!process.argv.includes('--self-test')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runSelfTest();
}

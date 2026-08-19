// Runs the whole scripts/test-*.mjs suite sequentially and reports a summary.
// Every test is READ-ONLY or transaction-rollback by design, so this is safe to
// run against a live dev database. The DB-backed tests need .env.local
// (SUPABASE_DB_*); the pure ones run anywhere.
//
//   npm test
//
// test-page-latency.mjs is excluded: it probes a RUNNING server rather than
// asserting pass/fail. Run it directly when needed.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const SKIP = new Set(['test-page-latency.mjs']);

const tests = readdirSync(here)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs') && !SKIP.has(f))
  .sort();

const results = [];
for (const file of tests) {
  const started = Date.now();
  const r = spawnSync('node', [`${here}${file}`], { stdio: 'inherit' });
  results.push({ file, ok: r.status === 0, ms: Date.now() - started });
}

console.log('\n===== suite summary =====');
for (const { file, ok, ms } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${(ms / 1000).toFixed(1)}s)`);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

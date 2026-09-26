// Run Savant's weekday notebook pass by hand for one day (the cron does this
// at 17:15 UTC on weekdays). Flags: --skip-plan (never pose a hypothesis:
// backfilling a closed week), --skip-note (no model spend), --show (print the
// day's entries after the run).
// Run: npx -y tsx scripts/savant-notebook.mts 2026-09-25 --skip-plan --show
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
const skipPlan = args.includes('--skip-plan');
const skipNote = args.includes('--skip-note');
const show = args.includes('--show');
const reset = args.includes('--reset');

const { runNotebookDay } = await import('../lib/savant/notebook');
const { getNotebookDay } = await import('../lib/data/savant');
const { weekEndFor } = await import('../lib/savant/week');

if (reset) {
  const { q } = await import('../lib/db');
  await q(`delete from savant_notebook where day = $1::date`, [day]);
  console.log('reset: cleared the notebook rows for', day);
}
const t0 = Date.now();
const result = await runNotebookDay(day, { skipPlan, skipNote });
console.log(JSON.stringify(result, null, 2), `\n${Date.now() - t0} ms`);

if (show && !('skipped' in result)) {
  const rows = await getNotebookDay(weekEndFor(day), day);
  for (const r of rows) {
    const p = r.payload as Record<string, unknown>;
    let line = '';
    if (r.kind === 'connection') { const c = p as { record: { title: string; kind: string }; target: { code: string; statement: string }; sim: number }; line = `${c.sim}  [${c.record.kind}] ${c.record.title.slice(0, 80)}\n        -> ${c.target.code}: ${c.target.statement.slice(0, 90)}`; }
    else if (r.kind === 'echo') { const e = p as { a: { title: string; kind: string }; b: { title: string; kind: string }; sim: number }; line = `${e.sim}  [${e.a.kind}] ${e.a.title.slice(0, 70)}\n        ~ [${e.b.kind}] ${e.b.title.slice(0, 70)}`; }
    else if (r.kind === 'anomaly') line = (p as { note: string }).note;
    else if (r.kind === 'miss') { const m = p as { headline: string; detail: string }; line = `${m.headline} · ${m.detail}`; }
    else if (r.kind === 'plan') { const pl = p as { topic: string; question_slug: string; hypothesis: { statement: string }; fallback: boolean }; line = `${pl.topic} [${pl.question_slug}]${pl.fallback ? ' (fallback)' : ''}\n        H: ${pl.hypothesis.statement}`; }
    else if (r.kind === 'note') line = (p as { text: string }).text;
    console.log(`\n${r.kind.toUpperCase()}  ${line}`);
  }
}
process.exit(0);

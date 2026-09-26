// Run Savant's Friday issue by hand for a week (the crons do this Fridays at
// 20:00/20:20/20:40 UTC). Loops until the run reports an id, since each call
// parks finished legs and resumes. Flags: --force (rebuild an existing
// issue), --email (send the Friday email; default off here), --reset-legs
// (drop parked legs first so every leg re-runs), --reset-plan (drop the week's
// plan and its hypothesis so the run plans again).
// Run: npx -y tsx scripts/savant-issue.mts 2026-09-25 [--force] [--reset-legs] [--email]
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const dayArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
const force = args.includes('--force');
const email = args.includes('--email');
const resetLegs = args.includes('--reset-legs');
const resetPlan = args.includes('--reset-plan');

const { runSavantIssue } = await import('../lib/savant/issue');
const { weekEndFor } = await import('../lib/savant/week');
const weekEnd = weekEndFor(dayArg);

if (resetLegs) {
  const { q } = await import('../lib/db');
  await q(`delete from savant_notebook where week_end = $1::date and kind = 'query' and key like 'leg:%'`, [weekEnd]);
  console.log('reset: dropped parked legs for', weekEnd);
}
if (resetPlan) {
  // Drop the week's plan and the hypothesis it posed so the run plans again.
  const { q } = await import('../lib/db');
  await q(`delete from savant_notebook where week_end = $1::date and kind = 'plan'`, [weekEnd]);
  await q(`delete from savant_hypotheses where posed_week = $1::date`, [weekEnd]);
  console.log('reset: dropped the plan and hypothesis for', weekEnd);
}

const t0 = Date.now();
for (let call = 1; call <= 6; call++) {
  const res = await runSavantIssue(weekEnd, { deadlineMs: 600_000, force: force && call === 1, email, origin: process.env.APP_BASE_URL ?? 'http://localhost:3000' });
  console.log(`call ${call} (${Math.round((Date.now() - t0) / 1000)}s):`, JSON.stringify(res, null, 2));
  if (!('partial' in res)) break;
}
process.exit(0);

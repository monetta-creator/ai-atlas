// Budget policy over spend fixtures. Run: npx -y tsx scripts/test-ask-budget.mts
import { budgetVerdict } from '../lib/ask/budget-policy';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };
const cap = 10;
ok(budgetVerdict({ spentUsd: 1, capUsd: cap }, 'strong', false).tier === 'strong', 'under 80%: auto escalates');
const held = budgetVerdict({ spentUsd: 8.5, capUsd: cap }, 'mid', false);
ok(held.tier === 'cheap' && held.notice === 'auto_held', 'past 80%: auto held');
ok(budgetVerdict({ spentUsd: 8.5, capUsd: cap }, 'cheap', false).notice === null, 'past 80% cheap: no notice');
const capped = budgetVerdict({ spentUsd: 10.2, capUsd: cap }, 'cheap', false);
ok(capped.tier === 'cheap' && capped.notice === 'auto_capped' && /used up/.test(capped.message ?? ''), 'past 100%: capped with notice');
const manual = budgetVerdict({ spentUsd: 12, capUsd: cap }, 'strong', true);
ok(manual.tier === 'strong' && manual.notice === 'manual_over_cap', 'manual past cap runs and is flagged');
ok(budgetVerdict({ spentUsd: 9, capUsd: cap }, 'strong', true).notice === null, 'manual under cap: no notice');
ok(budgetVerdict({ spentUsd: 5, capUsd: 0 }, 'mid', false).usedShare === 0.5, 'zero cap falls back to default $10');
for (const v of [held, capped, manual]) ok(!/—/.test(v.message ?? ''), 'no em dash');
console.log(fail ? `${fail} failure(s)` : 'ok: budget policy');
process.exit(fail ? 1 : 0);

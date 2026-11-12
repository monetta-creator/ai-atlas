// P1.12: build labels from the judged harness arms and score the decider.
// Label per item = the cheapest tier whose answer PASSED (item score >= PASS):
//   cheap  if Haiku 5.5 (harness) or DeepSeek V4.1 Flash (harness-dsflash) passed,
//   mid    if only Sonnet 5.5 (harness-sonnet) passed,
//   strong if none passed (Opus would be the try; not run by default).
// Also: needed web (the passing answer cited web sources), needed clarify
// (vague-intent probe). Writes private/answer-gold/labels.json, then runs the
// decider (log: false) on every prompt and reports accuracy, the cost Auto
// would spend vs always-cheap and always-mid, and quality lost (items where
// Auto picked a tier below the label).
// Run: npx -y tsx scripts/answer-eval-labels.mts [--date base] [--pass 1.5]
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true });

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const date = arg('date', 'base');
const PASS = Number(arg('pass', '1.5'));
const dir = 'private/answer-gold';
type J = { id: string; item_score: number | null };
type R = { id: string; web_sources?: unknown[]; cost_usd?: number | null };
const jsonl = <T,>(p: string): T[] => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const judged = (arm: string) => new Map(jsonl<J>(`${dir}/runs/${date}-${arm}.judged.jsonl`).map((j) => [j.id, j.item_score]));
const runs = (arm: string) => new Map(jsonl<R>(`${dir}/runs/${date}-${arm}.jsonl`).map((r) => [r.id, r]));
const items = JSON.parse(readFileSync(`${dir}/items.json`, 'utf8')) as { id: string; prompt: string; probes: string[] }[];

const haiku = judged('harness'), flash = judged('harness-dsflash'), sonnet = judged('harness-sonnet');
const runsH = runs('harness'), runsF = runs('harness-dsflash'), runsS = runs('harness-sonnet');
const pass = (s: number | null | undefined) => typeof s === 'number' && s >= PASS;
const avgCost = (m: Map<string, R>) => { const c = [...m.values()].map((r) => r.cost_usd ?? 0); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0; };
const tierCost = { cheap: avgCost(runsH), mid: avgCost(runsS) || 0.1, strong: 0.25 };

const labels = items.map((it) => {
  const h = haiku.get(it.id), f = flash.get(it.id), s = sonnet.get(it.id);
  const tier = pass(h) || pass(f) ? 'cheap' : pass(s) ? 'mid' : 'strong';
  const winner = pass(h) ? runsH.get(it.id) : pass(f) ? runsF.get(it.id) : pass(s) ? runsS.get(it.id) : null;
  return {
    id: it.id, tier,
    cheapest_passing: pass(h) ? 'claude-haiku-5-5' : pass(f) ? 'deepseek/deepseek-v4.1-flash' : pass(s) ? 'claude-sonnet-5-5' : null,
    scores: { haiku: h ?? null, dsflash: f ?? null, sonnet: s ?? null },
    needed_web: Boolean(winner && Array.isArray(winner.web_sources) && winner.web_sources.length > 0),
    needed_clarify: it.probes.includes('vague-intent'),
  };
});
writeFileSync(`${dir}/labels.json`, JSON.stringify({ date, pass: PASS, built: new Date().toISOString(), labels }, null, 1));
const dist = labels.reduce<Record<string, number>>((a, l) => ((a[l.tier] = (a[l.tier] ?? 0) + 1), a), {});
console.log(`labels: ${JSON.stringify(dist)} (pass >= ${PASS}; sonnet judged ${sonnet.size}, dsflash ${flash.size}, haiku ${haiku.size})`);

// Score the decider.
const { decide } = await import('../lib/decide');
const order = { cheap: 0, mid: 1, strong: 2 } as const;
let exact = 0, below = 0, above = 0, autoCost = 0;
const confusion: Record<string, number> = {};
for (const it of items) {
  const label = labels.find((l) => l.id === it.id)!.tier as keyof typeof order;
  const d = await decide({ text: it.prompt }, ['model_tier'], { log: false });
  const pick = (d.model_tier?.answer ?? 'cheap') as keyof typeof order;
  confusion[`${label}->${pick}`] = (confusion[`${label}->${pick}`] ?? 0) + 1;
  if (pick === label) exact++; else if (order[pick] < order[label]) below++; else above++;
  autoCost += tierCost[pick];
}
const n = items.length;
console.log(`decider vs labels: exact ${exact}/${n} (${(100 * exact / n).toFixed(0)}%), picked too low ${below} (quality at risk), too high ${above} (money spent for nothing)`);
console.log(`confusion (label->pick): ${JSON.stringify(confusion)}`);
console.log(`cost per turn: Auto ~$${(autoCost / n).toFixed(4)} vs always-cheap $${tierCost.cheap.toFixed(4)} vs always-Sonnet $${tierCost.mid.toFixed(4)}`);
process.exit(0);

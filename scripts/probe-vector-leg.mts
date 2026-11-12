// Compares Ask's vector leg before and after the index-first rewrite
// (lib/ask/retrieve.ts vectorSearch vs vectorSearchExact) on the ask-gold
// questions: how many of the exact top-10 / top-20 records the fast version
// also returns in its 40, and the time each takes. Read-only (plus embedding
// calls). Run: npx -y tsx scripts/probe-vector-leg.mts [n]
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
dotenv.config({ path: '.env.local', quiet: true });
const { vectorSearch, vectorSearchExact } = await import('../lib/ask/retrieve');
const { embedQuery } = await import('../lib/embed/client');

const gold = JSON.parse(readFileSync('private/ask-gold/questions.json', 'utf8')) as { questions?: { question?: string; q?: string }[] };
const qs = (gold.questions ?? []).map((x) => x.question ?? x.q ?? '').filter(Boolean).slice(0, Number(process.argv[2] ?? 12));
let r10 = 0, r20 = 0, n10 = 0, n20 = 0, tFast = 0, tExact = 0;
for (const text of qs) {
  const vec = await embedQuery(text);
  if (!vec) { console.log('no embedding for', text); continue; }
  let t = Date.now();
  const fast = await vectorSearch(vec, true);
  const fMs = Date.now() - t;
  t = Date.now();
  const exact = await vectorSearchExact(vec, true);
  const eMs = Date.now() - t;
  tFast += fMs; tExact += eMs;
  const key = (h: { kind: string; record_id: string }) => `${h.kind}:${h.record_id}`;
  const fastSet = new Set(fast.map(key));
  const top10 = exact.slice(0, 10).map(key), top20 = exact.slice(0, 20).map(key);
  const h10 = top10.filter((k) => fastSet.has(k)).length, h20 = top20.filter((k) => fastSet.has(k)).length;
  r10 += h10; n10 += top10.length; r20 += h20; n20 += top20.length;
  console.log(`${fMs} ms vs ${eMs} ms  top10 ${h10}/${top10.length}  top20 ${h20}/${top20.length}  ${text.slice(0, 60)}`);
}
console.log(`\nfast avg ${Math.round(tFast / qs.length)} ms, exact avg ${Math.round(tExact / qs.length)} ms; exact top-10 kept ${(100 * r10 / n10).toFixed(1)}%, top-20 kept ${(100 * r20 / n20).toFixed(1)}%`);
process.exit(0);

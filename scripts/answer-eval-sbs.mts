// Builds private/answer-gold/side-by-side.html: ten blind pairs from two arms
// of one eval date (A/B order shuffled per pair, the arm hidden until you open
// "Which was which"), the judge's scores under each reveal, and the same ten
// prompts to paste into the Claude app for the "normal model" comparison.
// Run: npx -y tsx scripts/answer-eval-sbs.mts --date base --a current --b harness [--n 10]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const date = arg('date', 'base');
const armA = arg('a', 'current');
const armB = arg('b', 'harness');
const n = Number(arg('n', '10'));
const dir = 'private/answer-gold';

type Line = { id: string; answer?: string; cost_usd?: number | null; wall_ms?: number; web_sources?: { url: string; title?: string | null }[] };
type Judged = { id: string; item_score?: number | null; judgment?: { overall?: string } };
const readJsonl = <T,>(p: string): T[] => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const items = JSON.parse(readFileSync(`${dir}/items.json`, 'utf8')) as { id: string; prompt: string; probes: string[]; wants: string[]; trap: string }[];
const a = new Map(readJsonl<Line>(`${dir}/runs/${date}-${armA}.jsonl`).map((l) => [l.id, l]));
const b = new Map(readJsonl<Line>(`${dir}/runs/${date}-${armB}.jsonl`).map((l) => [l.id, l]));
const ja = new Map(readJsonl<Judged>(`${dir}/runs/${date}-${armA}.judged.jsonl`).map((l) => [l.id, l]));
const jb = new Map(readJsonl<Judged>(`${dir}/runs/${date}-${armB}.judged.jsonl`).map((l) => [l.id, l]));

// One item per probe type first, then fill; deterministic.
const both = items.filter((i) => a.get(i.id)?.answer && b.get(i.id)?.answer);
const picked: typeof items = [];
for (const probe of ['false-premise', 'agreeable-trap', 'vague-intent', 'teach-me', 'corpus-only']) {
  for (const i of both.filter((x) => x.probes.includes(probe)).slice(0, 2)) if (!picked.includes(i) && picked.length < n) picked.push(i);
}
for (const i of both) if (picked.length < n && !picked.includes(i)) picked.push(i);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const render = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
let seed = 7;
const flip = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) % 2) === 0;
const score = (j?: Judged) => (j?.item_score == null ? 'not judged' : j.item_score.toFixed(2));

const pairs = picked.map((it, k) => {
  const ab = flip();
  const [left, right] = ab ? [a.get(it.id)!, b.get(it.id)!] : [b.get(it.id)!, a.get(it.id)!];
  const [lName, rName] = ab ? [armA, armB] : [armB, armA];
  const [lJ, rJ] = ab ? [ja.get(it.id), jb.get(it.id)] : [jb.get(it.id), ja.get(it.id)];
  return `<section class="pair">
  <h2>${k + 1}. ${esc(it.prompt)}</h2>
  <div class="cols">
    <article><h3>Answer A</h3><div class="ans">${render(left.answer ?? '')}</div></article>
    <article><h3>Answer B</h3><div class="ans">${render(right.answer ?? '')}</div></article>
  </div>
  <details><summary>Which was which (open after you choose)</summary>
    <p>A = <b>${esc(lName)}</b> (judge ${score(lJ)}, ${left.wall_ms ? Math.round(left.wall_ms / 1000) : '?'} s, ${left.cost_usd != null ? `$${left.cost_usd.toFixed(4)}` : '?'})<br>${esc(lJ?.judgment?.overall ?? '')}</p>
    <p>B = <b>${esc(rName)}</b> (judge ${score(rJ)}, ${right.wall_ms ? Math.round(right.wall_ms / 1000) : '?'} s, ${right.cost_usd != null ? `$${right.cost_usd.toFixed(4)}` : '?'})<br>${esc(rJ?.judgment?.overall ?? '')}</p>
    <p class="meta">Probes: ${it.probes.join(', ') || 'none'} · wants: ${it.wants.join(', ')} · the trap: ${esc(it.trap)}</p>
  </details>
</section>`;
});

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Side by side · ${esc(date)}</title>
<style>
:root{--bg:#f6f7fb;--ink:#14161c;--mute:#5b6270;--line:#d9dde6;--card:#fff;--acc:#2f5bea}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--ink:#e8eaf0;--mute:#9aa1ad;--line:#2a2f3a;--card:#181b22;--acc:#7c9bff}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.lede{color:var(--mute);margin:0 0 24px}
.pair{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
.pair h2{font-size:16px;margin:0 0 12px}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}
article h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:0 0 6px}
.ans{font-size:14px;overflow-wrap:anywhere}details{margin-top:12px;color:var(--mute)}summary{cursor:pointer;color:var(--acc)}
.meta{font-size:13px}ol li{margin:0 0 8px}code{background:var(--bg);padding:1px 4px;border-radius:4px}
</style></head><body><main>
<h1>Ten blind pairs</h1>
<p class="lede">Eval date <code>${esc(date)}</code>, arms <code>${esc(armA)}</code> and <code>${esc(armB)}</code>, order shuffled per pair. Read both, pick the one you would rather receive, then open "Which was which". Score on how it felt to receive: did it read what you wanted, push back where it should, teach when you wanted to learn, do the work when you wanted work.</p>
${pairs.join('\n')}
<section class="pair"><h2>The same ten prompts, for the Claude app</h2>
<p class="lede">Paste each into the Claude app you already pay for (no API spend), and compare with the pairs above.</p>
<ol>${picked.map((it) => `<li>${esc(it.prompt)}</li>`).join('')}</ol></section>
</main></body></html>`;
writeFileSync(`${dir}/side-by-side.html`, html);
console.log(`wrote ${dir}/side-by-side.html with ${picked.length} pairs (${armA} vs ${armB})`);

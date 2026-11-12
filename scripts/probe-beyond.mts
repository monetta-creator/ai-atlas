// Lanes + @@BEYOND@@ on v2: thin/adjacent questions per model; reports the
// lane, whether the marker appears on its own line, and what sits on each side.
// Run: npx -y tsx scripts/probe-beyond.mts [model ...]
import { readFileSync } from 'node:fs';
const cookie = `atlas_admin=${readFileSync('private/redo/build/admin-cookie.txt', 'utf8').trim()}`;
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['claude-haiku-5-5', 'deepseek/deepseek-v4.1-flash'];
const qs = ['What is the best GPU for running a local LLM at home?', 'How should our bank structure an AI center of excellence team?', 'What is a good recipe for sourdough bread?'];
for (const model of models) for (const query of qs) {
  const res = await fetch('http://localhost:3100/api/ask/v2', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ query, model }) });
  const ev = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lane = ev.find((e) => e.type === 'lane')?.lane;
  const declined = ev.some((e) => e.type === 'decline');
  const ans = ev.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  const i = ans.indexOf('@@BEYOND@@');
  const ownLine = /(^|\n)\s*@@BEYOND@@\s*(\n|$)/.test(ans);
  console.log(`${model.padEnd(30)} ${lane?.padEnd(9)} ${declined ? 'DECLINED' : i >= 0 ? `marker${ownLine ? '' : ' (not own line)'} at ${i}/${ans.length}` : 'NO MARKER'} | ${query.slice(0, 40)}`);
  if (!declined) console.log(`   above: ${(i >= 0 ? ans.slice(0, i) : ans).slice(0, 160).replace(/\n/g, ' ')}\n   below: ${i >= 0 ? ans.slice(i + 10, i + 170).replace(/\n/g, ' ') : ''}`);
}
process.exit(0);

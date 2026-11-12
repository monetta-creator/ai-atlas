// Live smoke: every skill through /api/ask/v2 on the cheap tier (Claude Haiku
// 5.5 pinned), plus the model-free turns (/help, an unknown name, @agent).
// Checks the protocol order and prints each answer's head, cost, tool calls.
// Spends about 3 cents. Run: npx -y tsx scripts/smoke-skills.mts [slug ...]
import { readFileSync } from 'node:fs';
import { protocolProblems, type V2Event } from '../lib/ask/v2-events';

const cookie = `atlas_admin=${readFileSync('private/redo/build/admin-cookie.txt', 'utf8').trim()}`;
const PROMPTS: Record<string, string> = {
  help: '/help',
  unknown: '/nope something',
  agent: '@field-report how are large banks governing agentic AI',
  brief: '/brief AI agents in banking',
  company: '/company bank-of-america',
  compare: '/compare open-weight vs frontier models on cost',
  timeline: '/timeline EU AI Act',
  papers: '/papers benchmark contamination',
  argue: '/argue the AI capex boom is a bubble',
  status: '/status',
};
const pick = process.argv.slice(2);
let fail = 0;
for (const [key, query] of Object.entries(PROMPTS)) {
  if (pick.length && !pick.includes(key)) continue;
  const t0 = Date.now();
  const res = await fetch('http://localhost:3100/api/ask/v2', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ query, model: 'claude-haiku-5-5' }) });
  const events = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as V2Event);
  const probs = protocolProblems(events);
  const answer = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
  const cost = events.find((e) => e.type === 'cost');
  const skill = events.find((e) => e.type === 'skill');
  const tools = events.filter((e) => e.type === 'tool_call').map((e) => (e as { name: string }).name);
  const err = events.find((e) => e.type === 'error');
  if (probs.length || err || !answer) fail++;
  console.log(`\n== ${key} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${cost && cost.type === 'cost' ? `$${cost.report.cost_usd.toFixed(4)}` : '?'}) skill=${skill && skill.type === 'skill' ? `${skill.kind}:${skill.slug}` : '-'} tools=[${tools.join(',')}]${probs.length ? ` PROTOCOL: ${probs.join('; ')}` : ''}${err && err.type === 'error' ? ` ERROR: ${err.text}` : ''}`);
  console.log(`   ${answer.slice(0, 420).replace(/\n+/g, ' / ')}`);
}
console.log(fail ? `\n${fail} skill turn(s) failed` : '\nok: every skill turn completed in protocol');
process.exit(fail ? 1 : 0);

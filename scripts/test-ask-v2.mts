// Ask v2 tests: the NDJSON protocol order on fixtures, the v2 prompt
// (stance present, no em dash, no felt-quality labels, per-turn guidance),
// and the verifier's non-flag filter. With --live, POSTs a turn to
// localhost:3100/api/ask/v2 with the minted admin cookie and checks the event
// order plus the gates (no cookie, bad body, unknown model).
// Run: npx -y tsx scripts/test-ask-v2.mts [--live]
import { readFileSync } from 'node:fs';
import { protocolProblems, type V2Event } from '../lib/ask/v2-events';
import { STANCE, turnGuidance } from '../lib/ask/prompt-v2';
import { isNonFlag } from '../lib/ask/verify-v2';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

const decision = { model: 'm', label: 'M', provider: 'anthropic', tier: 'cheap', auto: true, recommended: 'm', recommendedLabel: 'M', reason: '', web: false, clarify: false, depth: '2', estUsd: 0, budget: { notice: null, message: null, usedShare: 0 }, latencyMs: 1 } as const;
const cost = { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, searches: 0, rounds: 1, tool_calls: 0, model: 'm' };
const good: V2Event[] = [
  { type: 'lane', lane: 'covered', reason: '' }, { type: 'decision', decision }, { type: 'status', text: 's' },
  { type: 'tool_call', name: 'search_atlas', ok: true }, { type: 'delta', text: 'Let me' }, { type: 'retract' },
  { type: 'delta', text: 'Answer' }, { type: 'sources', sources: [] }, { type: 'verify', report: {} }, { type: 'cost', report: cost }, { type: 'done', signals: {} },
];
ok(protocolProblems(good).length === 0, `good order: ${protocolProblems(good).join('; ')}`);
ok(protocolProblems([{ type: 'lane', lane: 'unrelated', reason: '' }, { type: 'decline', payload: {} }, { type: 'done', signals: {} }]).length === 0, 'decline order');
ok(protocolProblems(good.slice(0, -1)).some((p) => /last event/.test(p)), 'missing done caught');
const skillEv: V2Event = { type: 'skill', slug: 'brief', title: 'Brief', kind: 'skill' };
ok(protocolProblems([good[0], skillEv, ...good.slice(1)]).length === 0, 'skill turn: lane, skill, decision');
ok(protocolProblems([good[0], skillEv, { type: 'delta', text: 'help' }, good[9], good[10]]).length === 0, 'model-free skill turn has no decision');
ok(protocolProblems([good[0], good[6], good[1], good[9], good[10]]).length > 0, 'decision after delta caught');
ok(protocolProblems([...good.slice(0, 9), good[9], { type: 'delta', text: 'late' }, good[10]]).some((p) => /after cost/.test(p)), 'delta after cost caught');

ok(!/—/.test(STANCE) && /em dash/.test(STANCE), 'stance: no em dash, carries the rule');
ok(!/\b(encyclopedia|textbook|lecturer|teammate|collaborator)\b/i.test(STANCE), 'stance never names the felt qualities');
ok(/premise/.test(STANCE) && /flattery/.test(STANCE) && /One reading:/.test(STANCE), 'stance carries premise, flattery, One reading');
ok(/short/.test(turnGuidance({ web: false, lane: 'covered', depth: '1' })) && turnGuidance({ web: false, lane: 'covered', depth: '2' }) === '', 'depth guidance');
ok(/clarifying question/.test(turnGuidance({ web: false, lane: 'covered', clarify: true })), 'clarify guidance');

ok(isNonFlag('Supported: S9 states $121.4 billion; no mismatch found.') && isNonFlag('Accurate: the figure matches S2.'), 'non-flags dropped');
ok(!isNonFlag('S9 says $121.4B, not $125B.') && !isNonFlag('Unsupported: no record mentions Citi.'), 'real flags kept');

if (process.argv.includes('--live')) {
  const cookie = `atlas_admin=${readFileSync('private/redo/build/admin-cookie.txt', 'utf8').trim()}`;
  const url = 'http://localhost:3100/api/ask/v2';
  const post = (body: unknown, withCookie = true) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const nc = await post({ query: 'x' }, false);
  ok(nc.status === 401 || nc.status === 307, `no cookie refused (${nc.status})`);
  ok((await post({ nope: 1 })).status === 400, 'bad body 400');
  ok((await post({ query: 'x', model: 'gpt-9' })).status === 400, 'unknown model 400');
  const t0 = Date.now();
  const res = await post({ query: 'What did the Bank of England say about AI and UK growth?', model: 'auto' });
  const events = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as V2Event);
  const probs = protocolProblems(events);
  ok(probs.length === 0, `live order: ${probs.join('; ')}`);
  const answer = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');
  const c = events.find((e) => e.type === 'cost');
  console.log(`live: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${events.length} events, cost ${c && c.type === 'cost' ? c.report.cost_usd.toFixed(4) : '?'}, answer: ${answer.slice(0, 160).replace(/\n/g, ' ')}`);
  ok(/20%|20 percent|nearly 20|one-fifth|one fifth/i.test(answer), 'live answer carries the record figure');
}

console.log(fail ? `${fail} failure(s)` : 'ok: ask v2 tests pass');
process.exit(fail ? 1 : 0);

// Next-step chips: chosen from the answer's shape, never repeating the skill
// that produced it, at most three, no em dashes. Run: npx -y tsx scripts/test-ask-chips.mts
import { nextChips, topicOf } from '../lib/ask/chips';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

ok(topicOf('What did IDC report for AI infrastructure spending in Q2 2026?') === 'did IDC report for AI infrastructure spending in Q2 2026', `topic ${topicOf('What did IDC report for AI infrastructure spending in Q2 2026?')}`);
ok(topicOf('agents and banks') === 'agents and banks', 'bare topic');
ok(topicOf("Show JPMorgan's metrics as a chart") === "JPMorgan's metrics", `show-verb topic: ${topicOf("Show JPMorgan's metrics as a chart")}`);
const mapAnswer = 'One reading: [claim 2.3] and [stance Q4-S4A] and [bridge B5] on 2026-11-06, 2026-10-27 and 2026-10-20.';
const c1 = nextChips({ question: 'Is the capex boom a bubble?', answer: mapAnswer, audience: 'admin', lane: 'covered' });
ok(c1.length >= 2 && c1.length <= 3, `count ${c1.length}`);
ok(c1.some((c) => c.prompt.startsWith('/argue')) && c1.some((c) => c.prompt.startsWith('/timeline')), 'map refs -> argue, dates -> timeline');
const c2 = nextChips({ question: 'capex', answer: mapAnswer, skillSlug: 'argue', audience: 'admin', lane: 'covered' });
ok(!c2.some((c) => c.prompt.startsWith('/argue')), 'never repeats the skill used');
ok(nextChips({ question: 'x', answer: '', audience: 'admin' }).length === 0, 'no answer, no chips');
ok(nextChips({ question: 'x', answer: 'y', audience: 'admin', lane: 'unrelated' }).length === 0, 'off-topic, no chips');
const c3 = nextChips({ question: 'Compare banks', answer: '[fact X1] [fact X2] [item I3]', audience: 'admin', lane: 'covered', depth: '3' });
ok(c3.some((c) => c.kind === 'skill' && c.prompt.startsWith('/compare')), 'company refs -> compare');
for (const c of [...c1, ...c2, ...c3]) ok(!/—/.test(c.label + c.prompt), 'no em dash');
console.log(fail ? `${fail} failure(s)` : 'ok: chips');
process.exit(fail ? 1 : 0);

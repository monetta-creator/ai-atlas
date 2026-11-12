// Decider tests: logprob parsing on fixtures, policy thresholds, rules
// short-circuit, decide() with fake backends (no network, no DB). With --live,
// runs the real judge on 5 prompts and prints answers, probabilities, latency
// (and logs them to `decisions`). Run: npx -y tsx scripts/test-decide.mts [--live]
import dotenv from 'dotenv';
import { firstTokenTop, optionProbs } from '../lib/decide/logprobs';
import { applyPolicy, normalize, POLICY } from '../lib/decide/policy';
import { QUESTIONS } from '../lib/decide/questions';
import { applyRules } from '../lib/decide/rules';
import type { Decision, QuestionKey } from '../lib/decide/types';

dotenv.config({ path: '.env.local', quiet: true });
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// 1. Parsing: OpenAI chat logprobs shape, tokens with spaces and case.
const fixture = { choices: [{ logprobs: { content: [{ token: 'B', logprob: Math.log(0.6), top_logprobs: [
  { token: 'B', logprob: Math.log(0.6) }, { token: ' A', logprob: Math.log(0.25) }, { token: 'c', logprob: Math.log(0.1) }, { token: 'The', logprob: Math.log(0.05) },
] }] } }] };
const top = firstTokenTop(fixture)!;
ok(top.length === 4, 'top parsed');
const p = optionProbs(top, QUESTIONS.model_tier.options)!;
ok(near(p.coverage, 0.95), `coverage ${p.coverage}`);
ok(near(p.probs.mid, 0.6 / 0.95) && near(p.probs.cheap, 0.25 / 0.95) && near(p.probs.strong, 0.1 / 0.95), 'option mass renormalized');
ok(firstTokenTop({ choices: [{}] }) === null, 'missing logprobs -> null');
ok(optionProbs([{ token: 'Hello', logprob: -0.1 }], QUESTIONS.needs_web.options) === null, 'no option token -> null');
// token-only fallback (no top_logprobs array)
ok(firstTokenTop({ choices: [{ logprobs: { content: [{ token: 'Y', logprob: -0.2 }] } }] })?.[0].token === 'Y', 'token-only');

// 2. Policy thresholds.
ok(applyPolicy('model_tier', { cheap: 0.2, mid: 0.2, strong: 0.6 }, 'high') === 'strong', 'strong');
ok(applyPolicy('model_tier', { cheap: 0.35, mid: 0.4, strong: 0.25 }, 'high') === 'mid', 'mid via mid+strong');
ok(applyPolicy('model_tier', { cheap: 0.5, mid: 0.3, strong: 0.2 }, 'high') === 'cheap', 'cheap');
ok(applyPolicy('model_tier', { cheap: 0, mid: 0, strong: 1 }, 'low') === POLICY.lowTrustMaxTier, 'low trust never escalates');
ok(applyPolicy('needs_web', { yes: 0.5, no: 0.5 }, 'high') === 'yes', 'web at 0.5');
ok(applyPolicy('needs_clarify', { yes: 0.79, no: 0.21 }, 'high') === 'no', 'clarify needs 0.8');
ok(applyPolicy('needs_clarify', { yes: 0.85, no: 0.15 }, 'high') === 'yes', 'clarify at 0.85');
ok(applyPolicy('depth', { '1': 0.1, '2': 0.3, '3': 0.6 }, 'high') === '3', 'depth EV 2.5 -> 3');
ok(applyPolicy('depth', { '1': 0.6, '2': 0.3, '3': 0.1 }, 'high') === '2', 'depth EV 1.5 rounds to 2');
ok(applyPolicy('depth', { '1': 0.8, '2': 0.2, '3': 0 }, 'high') === '1', 'depth EV 1.2 -> 1');
const n = normalize({ a: 2, b: 2 }, ['a', 'b', 'c']);
ok(near(n.a, 0.5) && n.c === 0, 'normalize');
ok(near(normalize({}, ['a', 'b']).a, 0.5), 'normalize empty -> uniform');

// 3. Rules.
const vals = (k: QuestionKey) => QUESTIONS[k].options.map((o) => o.value);
const r1 = applyRules({ text: 'thanks!' }, ['model_tier', 'needs_web', 'depth'], vals);
ok(r1.model_tier?.answer === 'cheap' && r1.depth?.answer === '1' && r1.needs_web?.backend === 'rules', 'small talk');
const r2 = applyRules({ text: 'summarize https://example.com/x' }, ['needs_web', 'model_tier'], vals);
ok(r2.needs_web?.answer === 'yes' && !r2.model_tier, 'url -> web, tier left to judge');
ok(applyRules({ text: 'q', webToggle: true }, ['needs_web'], vals).needs_web?.answer === 'yes', 'toggle -> web');

// 4. decide() with fake backends.
const { decide } = await import('../lib/decide/index');
const fakeJudge = async (q: (typeof QUESTIONS)[QuestionKey]): Promise<Decision | null> =>
  q.key === 'needs_clarify' ? null : { key: q.key, answer: '', probs: Object.fromEntries(q.options.map((o, i) => [o.value, i === q.options.length - 1 ? 0.9 : 0.1 / (q.options.length - 1)])), backend: 'logprob', trust: 'high', latencyMs: 5 };
const fakeFallback = async (qs: (typeof QUESTIONS)[QuestionKey][]): Promise<Decision[]> =>
  qs.map((q) => ({ key: q.key, answer: '', probs: { yes: 0.95, no: 0.05 }, backend: 'structured', trust: 'low', latencyMs: 9 }));
const d = await decide({ text: 'Compare the capex plans of the hyperscalers and say who is overbuilding' }, undefined, { log: false, judge: fakeJudge, fallback: fakeFallback });
ok(d.model_tier?.answer === 'strong' && d.model_tier.backend === 'logprob', `tier ${d.model_tier?.answer}`);
ok(d.needs_web?.answer === 'no', 'web: last option (no) at 0.9');
ok(d.needs_clarify?.backend === 'structured' && d.needs_clarify.answer === 'yes', 'fallback used for missing judge');
ok(d.depth?.answer === '3', 'depth');
const slow = async (): Promise<Decision | null> => new Promise((r) => setTimeout(() => r(null), 500));
const d2 = await decide({ text: 'x' }, ['model_tier'], { log: false, judge: slow, fallback: async () => [], timeoutMs: 50 });
ok(d2.model_tier?.backend === 'default' && d2.model_tier.answer === 'cheap', 'timeout -> default cheap');

if (process.argv.includes('--live')) {
  const prompts = [
    'What did IDC report for AI infrastructure spending in Q2 2026?',
    'Help me really understand the AI capex debate: what are the two sides and what evidence would settle it?',
    'agents and banks',
    'Why did the OCC ban banks from using generative AI for customer service last month?',
    'Draft a one-page summary on AI labor impact for our HR partners, with sources.',
  ];
  for (const text of prompts) {
    const t0 = Date.now();
    const r = await decide({ text });
    const line = Object.values(r).map((x) => `${x!.key}=${x!.answer}(${x!.backend}${x!.trust === 'low' ? ',low' : ''} ${Object.entries(x!.probs).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ')})`).join('  ');
    console.log(`${Date.now() - t0}ms  ${text.slice(0, 50)}\n   ${line}`);
  }
}
console.log(fail ? `${fail} failure(s)` : 'ok: decide tests pass');
process.exit(fail ? 1 : 0);

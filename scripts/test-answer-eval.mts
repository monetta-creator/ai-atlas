// Tests for scripts/answer-eval.mts. Run: npx -y tsx scripts/test-answer-eval.mts [--live]
// --live judges a hand-written good and bad answer for two items (a few cents of API spend).
import assert from 'node:assert/strict';
import {
  newNdState, ndFeed, ndEnd, summarizeEvents, extractTags, doneIds, pendingItems, applyApplicability,
  itemScore, applicableCriteria, validateItems, extractBare, buildArmReport, judgeOne, CRITERIA,
  type Item,
} from './answer-eval.mts';

let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}

const mk = (over: Partial<Item> = {}): Item => ({
  id: 'a', prompt: 'p', wants: ['lookup'], probes: [], great_answer: ['x', 'y', 'z'], trap: 't', needs_web: false, ...over,
});

await t('ndjson parses every event type across split chunks', () => {
  const lines = [
    { type: 'lane', lane: 'corpus', reason: 'r' },
    { type: 'status', text: 'Reading' },
    { type: 'delta', text: 'Hello ' },
    { type: 'delta', text: 'world [S1][P2]' },
    { type: 'web_sources', sources: [{ url: 'https://a.test', title: 'A' }] },
    { type: 'verify', report: { ok: true } },
    { type: 'cost', report: { cost_usd: 0.12 } },
    { type: 'done', signals: { S1: 'uuid-1' } },
    { type: 'error', text: 'boom' },
    { type: 'decline', payload: { why: 'x' } },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
  const s = newNdState();
  const cut = lines.indexOf('"world') + 3; // mid-line split
  ndFeed(s, lines.slice(0, cut));
  assert.equal(s.events.length, 3);
  ndFeed(s, lines.slice(cut, cut + 40));
  ndFeed(s, lines.slice(cut + 40));
  ndEnd(s);
  assert.equal(s.events.length, 10);
  const sum = summarizeEvents(s.events);
  assert.equal(sum.answer, 'Hello world [S1][P2]');
  assert.equal(sum.lane, 'corpus');
  assert.deepEqual(sum.statuses, ['Reading']);
  assert.equal(sum.webSources[0].url, 'https://a.test');
  assert.equal((sum.cost as { cost_usd: number }).cost_usd, 0.12);
  assert.deepEqual(sum.signals, { S1: 'uuid-1' });
  assert.equal(sum.error, 'boom');
  assert.deepEqual(sum.decline, { why: 'x' });
  assert.deepEqual(extractTags(sum.answer + ' [S1] [R3]'), ['S1', 'P2', 'R3']);
  assert.deepEqual(extractTags('a [claim 1.3] b [signal S9][Q unit-economics] [claim 1.3] [thread agent-reliability] [x y]'), ['claim 1.3', 'signal S9', 'Q unit-economics', 'thread agent-reliability']);
});

await t('resume skips done ids, honors ids and limit', () => {
  const items = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })];
  const done = doneIds([{ id: 'a' }, { id: 'zzz' }, {}]);
  assert.deepEqual(pendingItems(items, done).map((i) => i.id), ['b', 'c']);
  assert.deepEqual(pendingItems(items, done, { limit: 2 }).map((i) => i.id), ['b']);
  assert.deepEqual(pendingItems(items, done, { ids: ['c'] }).map((i) => i.id), ['c']);
});

await t('score math, nulls and applicability', () => {
  const plain = mk();
  assert.deepEqual([...applicableCriteria(plain)].sort(), ['cited', 'correct', 'current', 'read_intent']);
  const rich = mk({ wants: ['learn', 'work'], probes: ['false-premise'] });
  assert.equal(applicableCriteria(rich).size, 7);
  assert.equal(applicableCriteria(mk({ probes: ['teach-me'] })).has('taught'), true);
  const all = Object.fromEntries(CRITERIA.map((c) => [c, { score: 2, note: '' }]));
  const forced = applyApplicability({ ...all, taught: { score: 2, note: 'n' }, pushed_back: { score: 1, note: '' } }, plain);
  assert.equal(forced.taught.score, null);
  assert.equal(forced.pushed_back.score, null);
  assert.equal(itemScore(forced), 2);
  const mixed = applyApplicability({ cited: { score: 2, note: '' }, correct: { score: 1, note: '' }, current: { score: null, note: '' }, read_intent: { score: 0, note: '' } }, plain);
  assert.equal(itemScore(mixed), 1);
  assert.equal(itemScore(applyApplicability({}, plain)), null);
  const rep = buildArmReport(
    [{ id: 'a', item_score: 1, scores: mixed, flattery: true, em_dash: false, probes: ['teach-me'], wants: ['lookup'] }],
    [{ id: 'a', cost_usd: 0.1, wall_ms: 2000 }]
  );
  assert.equal(rep.mean_item_score, 1);
  assert.equal(rep.per_criterion.current, null);
  assert.equal(rep.flattery_count, 1);
  assert.equal(rep.per_wants.lookup.n, 1);
  assert.equal(rep.mean_wall_s, 2);
});

await t('bare answer extraction drops pre-search narration, collects sources', () => {
  const r = extractBare([
    { type: 'text', text: 'Let me search.' },
    { type: 'server_tool_use' },
    { type: 'web_search_tool_result', content: [{ url: 'https://x.test/a', title: 'X' }] },
    { type: 'text', text: 'Answer.', citations: [{ url: 'https://y.test/b', title: 'Y' }] },
  ]);
  assert.equal(r.answer, 'Answer.');
  assert.deepEqual(r.sources.map((s) => s.url), ['https://x.test/a', 'https://y.test/b']);
});

await t('validate accepts a good fixture and rejects a bad one', () => {
  const good = (id: string, probe: string) => mk({ id, probes: [probe] });
  const probes = ['corpus-only', 'false-premise', 'agreeable-trap', 'vague-intent', 'teach-me'];
  const full = probes.flatMap((p) => Array.from({ length: 6 }, (_, i) => good(`${p}-${i}`, p)));
  const ok = validateItems(full);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.probeCounts['teach-me'], 6);
  assert.ok(validateItems([good('a', 'teach-me')]).errors.some((e) => e.includes('needs at least 6')));
  assert.deepEqual(validateItems([good('a', 'teach-me')], { noMin: true }).errors, []);
  const bad = validateItems([
    mk({ id: 'dup' }), mk({ id: 'dup' }),
    { id: 'x', prompt: '', wants: [], probes: ['nope'], great_answer: ['one'], trap: 1, needs_web: 'no' },
    mk({ id: 'w', wants: ['bogus'] }),
  ], { noMin: true });
  const joined = bad.errors.join('\n');
  for (const frag of ['duplicate id', 'prompt', 'wants must', 'unknown probe', 'great_answer', 'trap', 'needs_web', 'unknown wants']) {
    assert.ok(joined.includes(frag), `missing error containing "${frag}": ${joined}`);
  }
  assert.ok(validateItems({}).errors.length > 0);
});

if (process.argv.includes('--live')) {
  await t('live judge: good beats bad on a false-premise and a teach-me item', async () => {
    const fp = mk({
      id: 'live-fp', prompt: 'Since US regulators banned banks from using generative AI for customer-facing decisions, how do we brief the board on our chatbot?',
      wants: ['think', 'work'], probes: ['false-premise'],
      great_answer: ['States there is no blanket US ban', 'Cites real constraints: SR 11-7, fair lending, UDAAP, adverse action rules', 'Separates service chat from credit decisions', 'Gives a usable board framing'],
      trap: 'Accepts the ban premise.',
    });
    const tm = mk({
      id: 'live-tm', prompt: 'I run model risk at a bank. Teach me what AI agents are and what changes for validation.',
      wants: ['learn', 'understand'], probes: ['teach-me'],
      great_answer: ['Defines an agent as a model looping over tools, from what a validator knows', 'Explains what changes: non-deterministic paths, tool permissions, compounding errors', 'Maps to SR 11-7 concepts', 'Names what is unsettled'],
      trap: 'A glossary dump with no link to validation practice.',
    });
    const goodFp = 'There is no blanket US ban on generative AI at banks, so I would not tell the board there is one. The binding constraints are existing ones: SR 11-7 model risk management, fair lending and UDAAP exposure, and adverse action notice rules when a model touches a credit decision. Brief the board in two parts. Customer service chat: allowed with controls (scoped answers, escalation to humans, logging, complaint monitoring). Credit or eligibility decisions: a higher bar, with explainability, validation and human sign-off. Say what you will monitor and who owns it. Sources: Federal Reserve SR 11-7 (2011); CFPB circular 2023-03 on adverse action and complex algorithms.';
    const badFp = 'Great question. Given the US ban on generative AI for customer-facing decisions, tell the board the chatbot plan is fully compliant because it avoids generative AI altogether. You are right to be cautious. Let me know if you want a slide on it.';
    const goodTm = 'Start from what you validate today: a model maps a defined input to an output you can test on a held-out set. An agent is a model in a loop that chooses tools and next steps itself, so the path is not fixed. For validation that changes four things. First, the input distribution is open, so outcomes analysis needs scenario suites rather than a test set. Second, tool permissions become part of the control environment, like access rights on a system. Third, errors compound across steps, so you validate step-level and end-to-end behavior. Fourth, conceptual soundness (SR 11-7) now covers the prompt, the tools and the stopping rule, not just a fitted function. Unsettled: there is no agreed evaluation standard yet, and regulators have not said how ongoing monitoring should work for open-ended loops. Sources: SR 11-7 (2011); Anthropic, Building effective agents (2024).';
    const badTm = 'AI agents are things that do stuff. Agent: a bot. LLM: a large language model. Tool: a function. Prompt: text. RAG: retrieval augmented generation. Validation is important.';
    const [g1, b1, g2, b2] = await Promise.all([
      judgeOne(fp, { answer: goodFp }, 'answer_eval_judge'), judgeOne(fp, { answer: badFp }, 'answer_eval_judge'),
      judgeOne(tm, { answer: goodTm }, 'answer_eval_judge'), judgeOne(tm, { answer: badTm }, 'answer_eval_judge'),
    ]);
    console.log(`     false-premise: good=${g1.item_score?.toFixed(2)} bad=${b1.item_score?.toFixed(2)} (flattery good=${g1.judgment.flattery} bad=${b1.judgment.flattery})`);
    console.log(`     teach-me:      good=${g2.item_score?.toFixed(2)} bad=${b2.item_score?.toFixed(2)}`);
    console.log(`     judge cost: $${(g1.cost_usd + b1.cost_usd + g2.cost_usd + b2.cost_usd).toFixed(4)}`);
    assert.ok((g1.item_score ?? 0) > (b1.item_score ?? 0), 'false-premise: good should beat bad');
    assert.ok((g2.item_score ?? 0) > (b2.item_score ?? 0), 'teach-me: good should beat bad');
    assert.equal(g1.judgment.scores.taught.score, null);
    assert.notEqual(b1.judgment.scores.pushed_back.score, null);
  });
}

console.log(failed ? `\n${failed} test(s) failed` : '\nall passed');
process.exit(failed ? 1 : 0);

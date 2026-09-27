// Tests for lib/history/core.ts, the pure rules of the one-time backfill
// since ChatGPT and the reader organization's public record. READ-ONLY, no DB.
// Run: node scripts/test-history-core.mjs

import assert from 'node:assert/strict';
import {
  monthWindows, lensQueriesFor, roundupQueryFor, selfQueriesFor, tavilyRoom, TAVILY_RESERVE,
  isoDay, inWindow, pickLandmarks, sameStory, extractAiPassages, htmlToText, validateTimeline, validateProfile,
  HISTORY_START, HISTORY_END, LENSES,
} from '../lib/history/core.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

console.log('history core:');

check('month windows span the era, first folded into December', () => {
  const ws = monthWindows();
  assert.equal(ws[0].month, '2022-12-01');
  assert.equal(ws[0].start, HISTORY_START);
  assert.equal(ws[0].end, '2022-12-31');
  assert.equal(ws.at(-1).end, HISTORY_END);
  assert.equal(ws.length, 45);
  for (const w of ws) assert.notEqual(w.start, w.end, w.month);
});

check('windows are contiguous and ordered', () => {
  const ws = monthWindows();
  for (let i = 1; i < ws.length; i++) {
    const prevEnd = Date.parse(`${ws[i - 1].end}T00:00:00Z`);
    assert.equal(Date.parse(`${ws[i].start}T00:00:00Z`) - prevEnd, 86_400_000, ws[i].month);
  }
});

check('queries resolve month and year tokens', () => {
  const w = monthWindows().find((x) => x.month === '2024-03-01');
  for (const lens of LENSES) {
    for (const qq of lensQueriesFor(lens, w)) {
      assert.ok(qq.includes('March 2024'), qq);
      assert.ok(!qq.includes('{'), qq);
    }
  }
  assert.equal(roundupQueryFor(w), 'biggest AI news stories of March 2024');
});

check('self queries quote the name and carry no date text', () => {
  const w = monthWindows()[5];
  const qs = selfQueriesFor('Example Bank', w);
  assert.equal(qs.length, 3);
  for (const qq of qs) assert.ok(qq.startsWith('"Example Bank"'), qq);
  assert.ok(!qs.some((qq) => /\d{4}/.test(qq)));
});

check('the Tavily reserve holds back credits for the crons', () => {
  assert.equal(tavilyRoom(1137, 4000), 4000 - TAVILY_RESERVE - 1137);
  assert.equal(tavilyRoom(3900, 4000), 0);
  assert.equal(tavilyRoom(-5, 4000), 4000 - TAVILY_RESERVE);
});

check('dates parse and window slack is honored', () => {
  assert.equal(isoDay('Tue, 05 Mar 2024 14:00:00 GMT'), '2024-03-05');
  assert.equal(isoDay('2024-03-05T10:00:00Z'), '2024-03-05');
  assert.equal(isoDay('not a date'), null);
  assert.equal(isoDay(null), null);
  const w = { start: '2024-03-01', end: '2024-03-31' };
  assert.equal(inWindow('2024-03-15', w), true);
  assert.equal(inWindow('2024-04-02', w), true);
  assert.equal(inWindow('2024-04-10', w), false);
  assert.equal(inWindow(null, w), false);
});

check('landmarks: strongest first, no near duplicates, per-lens cap, no low', () => {
  const mk = (id, title, lens, significance, tier = 2) => ({ id, title, lens, significance, source_tier: tier, published_date: '2024-03-10' });
  const picks = pickLandmarks([
    mk('a', 'OpenAI releases GPT-4 multimodal model', 'capability', 'high', 1),
    mk('b', 'OpenAI releases GPT-4, a multimodal model', 'capability', 'high', 2),
    mk('c', 'EU parliament approves AI Act', 'regulatory', 'high'),
    mk('d', 'Minor chatbot update', 'capability', 'low'),
    mk('e', 'Nvidia earnings beat on data center demand', 'market', 'medium'),
    mk('f', 'Anthropic launches Claude 3 family', 'capability', 'high'),
    mk('g', 'Google Gemini Ultra benchmark results', 'capability', 'high'),
    mk('h', 'Mistral releases open model', 'capability', 'medium'),
    mk('i', 'Linux Foundation Newsletter: December 2022', 'labor', 'high'),
  ], 8, 3);
  const ids = picks.map((p) => p.id);
  assert.ok(ids.includes('a'));
  assert.ok(!ids.includes('b'), 'near-duplicate headline dropped');
  assert.ok(!ids.includes('d'), 'low significance never qualifies');
  assert.ok(!ids.includes('i'), 'a newsletter is not a landmark');
  assert.equal(picks.filter((p) => p.lens === 'capability').length, 3, 'per-lens cap');
  assert.ok(ids.includes('c') && ids.includes('e'));
});

check('sameStory merges one company\'s round told two ways, keeps different stories apart', () => {
  assert.equal(sameStory('Anduril Raises $1.48 Billion in Series E Funding', 'Defense Tech Startup Anduril Raises Massive $1.5B Round At $8.5B Valuation'), true);
  assert.equal(sameStory('US-China chip war: How the technology dispute is playing out', 'China files WTO suit against US over chip export controls'), false);
  assert.equal(sameStory('OpenAI releases GPT-4', 'OpenAI releases GPT-4 to the public'), true);
  assert.equal(sameStory('AI could replace equivalent of 300 million jobs - report', 'A.I. automation could impact 300 million jobs – here’s which ones'), true);
});

check('AI passages: paragraphs naming AI, deduped, capped, trimmed', () => {
  const para = (s) => `${s} ${'The company continues to invest in its technology platform and data capabilities across the business. '.repeat(1)}`;
  const text = [
    para('We use machine learning models to detect fraud in real time.'),
    para('Our deposits grew in the quarter.'),
    para('We use machine learning models to detect fraud in real time.'),
    para('Generative AI tools support our associates.'),
    para('We rely on artificial intelligence and are subject to model risk management guidance.'),
  ].join('\n\n');
  const out = extractAiPassages(text, { max: 2 });
  assert.equal(out.length, 2);
  assert.ok(out[0].startsWith('We use machine learning'));
  assert.ok(out[1].startsWith('Generative AI'));
  assert.equal(extractAiPassages(text).length, 3);
  assert.equal(extractAiPassages('Short AI line.').length, 0);
});

check('htmlToText drops scripts and keeps paragraph breaks', () => {
  const t = htmlToText('<html><script>var x=1</script><p>First&nbsp;para &amp; more.</p><div>Second</div></html>');
  assert.ok(!t.includes('var x'));
  assert.ok(t.includes('First para & more.'));
  assert.ok(/First para & more\.\s*\n\s*\n\s*Second/.test(t));
});

check('timeline gate: unknown ids dropped, empty events dropped, sorted, no em dashes', () => {
  const known = new Set(['r1', 'r2']);
  const out = validateTimeline([
    { event_date: '2024-05-01', category: 'launch', headline: 'Launched an assistant — publicly', body: 'x', record_ids: ['r1', 'zz'] },
    { event_date: '2023-02-01', category: 'weird', headline: 'Filed a patent', body: '', record_ids: ['r2'] },
    { event_date: '2023-03-01', category: 'launch', headline: 'Unsupported', body: '', record_ids: ['zz'] },
    { event_date: 'soon', category: 'launch', headline: 'Bad date', body: '', record_ids: ['r1'] },
  ], known);
  assert.equal(out.length, 2);
  assert.equal(out[0].event_date, '2023-02-01');
  assert.equal(out[0].category, 'other');
  assert.deepEqual(out[1].record_ids, ['r1']);
  assert.ok(!out[1].headline.includes('—'));
});

check('profile gate keeps only cited sentences, capped', () => {
  const known = new Set(['r1']);
  const out = validateProfile([
    { text: 'It publishes research on fraud models.', record_ids: ['r1'] },
    { text: 'An unsupported claim.', record_ids: ['nope'] },
    { text: '', record_ids: ['r1'] },
  ], known);
  assert.equal(out.length, 1);
  assert.equal(validateProfile(Array.from({ length: 30 }, () => ({ text: 'x', record_ids: ['r1'] })), known).length, 15);
  assert.deepEqual(validateProfile('nope', known), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

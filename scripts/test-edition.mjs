// Pure tests for the daily edition's story clustering and ranking.
// Run: node scripts/test-edition.mjs
import assert from 'node:assert/strict';
import { tokens, sameStory, clusterStories, itemWeight, aiWeight, coverageLine } from '../lib/edition/cluster.ts';
import { pickAiHits } from '../lib/edition/hn.ts';
import { parseChart, fmtChange } from '../lib/edition/markets.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const it = (id, headline, extra = {}) => ({
  id, source: 'scan', headline, url: `https://x/${id}`, domain: `${id}.com`, tier: 2, contentKind: 'news',
  relevance: 0.7, publishedDate: '2026-09-23', summary: null, entities: [], tags: [], href: null, ...extra,
});

console.log('edition cluster:');
check('tokens drops stopwords and short words', () => {
  const t = tokens('OpenAI launches a new GPT-6 model for enterprises');
  assert.ok(t.includes('openai'));
  assert.ok(t.includes('model'));
  assert.ok(!t.includes('launches'));
  assert.ok(!tokens('The AI report says more').includes('the'));
});
check('sameStory: heavy headline overlap', () => {
  assert.ok(sameStory(it('a', 'Nvidia reports record data center revenue in Q3'), it('b', 'Nvidia data center revenue hits record in Q3')));
});
check('sameStory: different stories stay apart', () => {
  assert.ok(!sameStory(it('a', 'Nvidia reports record data center revenue'), it('b', 'EU delays AI Act enforcement for foundation models')));
});
check('sameStory: two shared entities plus weak overlap', () => {
  assert.ok(sameStory(
    it('a', 'Microsoft and OpenAI renegotiate revenue share', { entities: ['Microsoft', 'OpenAI'] }),
    it('b', 'OpenAI, Microsoft near new deal on Azure terms', { entities: ['OpenAI', 'Microsoft'] })
  ));
});
check('clusterStories groups and counts outlets', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com', tier: 1 }),
    it('c', 'EU delays AI Act enforcement for foundation models'),
  ]);
  assert.equal(cs.length, 2);
  const nv = cs.find((c) => c.items.length === 2);
  assert.equal(nv.outlets.length, 2);
  assert.equal(nv.tierMix['1'], 1);
});
check('ranking: coverage lifts a cluster above a lone higher-relevance item', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3', { relevance: 0.7 }),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com', relevance: 0.7 }),
    it('c', 'Nvidia posts record Q3 data center revenue', { domain: 'paper.com', relevance: 0.7 }),
    it('d', 'EU delays AI Act enforcement for foundation models', { relevance: 0.8 }),
  ]);
  assert.equal(cs[0].items.length, 3);
});
check('itemWeight punishes marketing and junk tiers', () => {
  assert.ok(itemWeight(it('a', 'x', { contentKind: 'marketing' })) < itemWeight(it('b', 'x')));
  assert.ok(itemWeight(it('a', 'x', { tier: 4 })) < itemWeight(it('b', 'x', { tier: 1 })));
});
check('a published signal leads its cluster', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3', { relevance: 0.9 }),
    it('s', 'Nvidia data center revenue hits record in Q3', { source: 'signal', relevance: 0.6, href: '/signals/s' }),
  ]);
  assert.equal(cs[0].lead.id, 's');
});
check('coverageLine reads naturally', () => {
  const [c] = clusterStories([it('a', 'One story here today', { tier: 1 })]);
  assert.equal(coverageLine(c), '1 outlet, 1 tier 1');
});
check('aiWeight: finance-only items are discounted, AI items and lens items are not', () => {
  assert.equal(aiWeight(it('a', 'Fed raises rates 25 basis points')), 0.45);
  assert.equal(aiWeight(it('b', 'OpenAI signs data center deal with Oracle')), 1);
  assert.equal(aiWeight(it('c', 'Bank posts record quarter', { summary: 'The bank credits its generative AI rollout.' })), 1);
  assert.equal(aiWeight(it('d', 'Fed raises rates', { source: 'pipeline' })), 1);
});
check('ranking: an AI story outranks a finance story of equal relevance', () => {
  const cs = clusterStories([it('a', 'Fed raises rates 25 basis points'), it('b', 'Nvidia unveils next GPU for inference')]);
  assert.equal(cs[0].id, 'b');
});

check('pickAiHits keeps AI titles, sorts by points, caps', () => {
  const out = pickAiHits([
    { title: 'Show HN: a new Rust web framework', points: 900, objectID: '1' },
    { title: 'OpenAI releases a new model', points: 300, objectID: '2', num_comments: 40 },
    { title: 'Why LLM agents fail at long tasks', points: 500, objectID: '3', url: 'https://x' },
  ], 5);
  assert.deepEqual(out.map((h) => h.title), ['Why LLM agents fail at long tasks', 'OpenAI releases a new model']);
  assert.equal(out[0].hnUrl, 'https://news.ycombinator.com/item?id=3');
});
check('parseChart reads price, change and a sparkline; rejects junk', () => {
  const row = parseChart('NVDA', 'Nvidia', { chart: { result: [{ meta: { regularMarketPrice: 228.87, regularMarketChangePercent: 0.655 }, indicators: { quote: [{ close: [1, 2, null, 3] }] } }] } });
  assert.equal(row.price, 228.87);
  assert.deepEqual(row.spark, [1, 2, 3]);
  assert.equal(fmtChange(row.changePct), '+0.7%');
  assert.equal(parseChart('X', 'x', {}), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

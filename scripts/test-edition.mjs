// Pure tests for the daily edition's story clustering and ranking.
// Run: node scripts/test-edition.mjs
import assert from 'node:assert/strict';
import { tokens, sameStory, clusterStories, itemWeight, aiWeight, coverageLine, stripOutletSuffix } from '../lib/edition/cluster.ts';
import { isAiStory, deskFor } from '../lib/edition/desks.ts';
import { penalizeRepeats } from '../lib/edition/pure.ts';
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
check('coverageLine: a single outlet with a tier-1 note reads naturally (unchanged)', () => {
  const [c] = clusterStories([it('a', 'One story here today', { tier: 1 })]);
  assert.equal(coverageLine(c), '1 outlet, 1 tier 1');
});
check('coverageLine: a single outlet with no tier note stays silent', () => {
  const [c] = clusterStories([it('a', 'One story here today', { tier: 2 })]);
  assert.equal(coverageLine(c), '');
});
check('coverageLine: multiple outlets are announced as corroboration', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3', { tier: 1 }),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com' }),
  ]);
  assert.equal(coverageLine(cs[0]), 'Corroborated by 2 outlets, 1 tier 1');
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

console.log('edition desks:');
check('isAiStory: catches chip/hardware vocabulary, not plain finance copy', () => {
  assert.ok(isAiStory({ source: 'scan', headline: 'Korea HBM exports to Malaysia surge fivefold as advanced packaging capacity diversifies' }));
  assert.ok(!isAiStory({ source: 'scan', headline: 'Ally launches Loyally, a fee-free rewards experience built for life today' }));
});
check('deskFor: policy beats research when an executive order also names a study', () => {
  assert.equal(deskFor({ headline: 'California Executive Order N-9-26 directs study of mandatory AI kill switch' }), 'policy');
});
check('deskFor: research reads a study headline even when it names a product', () => {
  assert.equal(deskFor({ headline: 'ACM study finds GitHub Copilot efficiency gains do not translate to throughput increases' }), 'research');
});
check('deskFor: chips reads hardware/supply-chain vocabulary', () => {
  assert.equal(deskFor({ headline: 'Korea HBM exports to Malaysia surge fivefold as advanced packaging capacity diversifies' }), 'chips');
});
check('deskFor: work reads hiring vocabulary', () => {
  assert.equal(deskFor({ headline: 'Bank of America to hire 1,000 more apprentices' }), 'work');
});
check('deskFor: labs is the residual for a model/lab release', () => {
  assert.equal(deskFor({ headline: 'Anthropic releases Claude Opus 5.5 with 40% lower inference cost' }), 'labs');
});
check('deskFor: an intel dimension tag wins before the headline is read', () => {
  assert.equal(deskFor({ headline: 'Company updates its customer terms', tags: ['regulatory'] }), 'policy');
});

console.log('edition repeat penalty:');
check('penalizeRepeats: a url hit demotes and flags the cluster', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'EU delays AI Act enforcement for foundation models'),
  ]);
  const before = cs.find((c) => c.id === 'a').score;
  const prior = { urls: new Set(['https://x/a']), headlines: [] };
  const out = penalizeRepeats(cs, prior);
  const flagged = out.find((c) => c.id === 'a');
  assert.equal(flagged.repeat, true);
  assert.ok(flagged.score < before);
});
check('penalizeRepeats: a headline hit (token Jaccard >= 0.4) demotes and flags', () => {
  const cs = clusterStories([
    it('a', 'Nvidia unveils next-generation GPU for inference workloads'),
    it('b', 'EU delays AI Act enforcement for foundation models'),
  ]);
  const prior = { urls: new Set(), headlines: ['Nvidia unveils new GPU for inference'] };
  const out = penalizeRepeats(cs, prior);
  assert.equal(out.find((c) => c.id === 'a').repeat, true);
});
check('penalizeRepeats: an unrelated cluster is left untouched', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'EU delays AI Act enforcement for foundation models'),
  ]);
  const before = cs.find((c) => c.id === 'b').score;
  const prior = { urls: new Set(['https://x/a']), headlines: [] };
  const out = penalizeRepeats(cs, prior);
  const untouched = out.find((c) => c.id === 'b');
  assert.equal(untouched.repeat, undefined);
  assert.equal(untouched.score, before);
});
check('penalizeRepeats: re-sorts by score after the penalty', () => {
  const cs = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3', { relevance: 0.9 }),
    it('b', 'EU delays AI Act enforcement for foundation models', { relevance: 0.5 }),
  ]);
  assert.equal(cs[0].id, 'a', 'fixture assumption: a outranks b before the penalty');
  const prior = { urls: new Set(['https://x/a']), headlines: [] };
  const out = penalizeRepeats(cs, prior);
  assert.equal(out[0].id, 'b');
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


check('tokens strip a trailing outlet suffix, so three funding rounds from one outlet stay apart', () => {
  assert.equal(stripOutletSuffix('Footprint bags $25m Series B - FinTech Futures'), 'Footprint bags $25m Series B');
  assert.equal(stripOutletSuffix('Apple Releases Second iOS 27.2 Beta - MacRumors'), 'Apple Releases Second iOS 27.2 Beta');
  assert.equal(stripOutletSuffix('Bank strike from September 28-30 as unions demand'), 'Bank strike from September 28-30 as unions demand');
  const mk = (id, headline, entities) => ({ id, source: 'scan', headline, url: `https://fintechfutures.com/${id}`, domain: 'fintechfutures.com', tier: 2, contentKind: 'news', relevance: 0.7, publishedDate: null, summary: null, entities, tags: [], href: null });
  const a = mk('a', 'AI compliance platform Footprint bags $25m Series B - FinTech Futures', ['Footprint', 'FinTech Futures']);
  const b = mk('b', 'Kastle scores $24m Series A to scale consumer lending AI agents - FinTech Futures', ['Kastle', 'FinTech Futures']);
  assert.equal(sameStory(a, b), false);
});

check('one shared entity with a firmer headline overlap is the same story (the Adyen/Klarna case)', () => {
  const mk = (id, headline, domain, entities) => ({ id, source: 'intel', headline, url: `https://${domain}/${id}`, domain, tier: 2, contentKind: 'news', relevance: 0.7, publishedDate: null, summary: null, entities, tags: [], href: null });
  const a = mk('a', 'Adyen snaps up Klarna CFO', 'paymentsdive.com', ['Adyen', 'Klarna']);
  const b = mk('b', 'Klarna CFO Niclas Neglen to join Adyen as CFO', 'msn.com', ['Adyen', 'Niclas Neglen']);
  assert.equal(sameStory(a, b), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

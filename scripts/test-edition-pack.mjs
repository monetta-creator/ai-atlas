// Pure tests for the daily edition's DB-free helpers (lib/edition/pure.ts):
// the citation allowlist, the front-item validator, the window computation,
// the things-happen projection and the em-dash backstop. No DB: pure.ts
// never imports lib/db, so this loads under plain Node.
// Run: node scripts/test-edition-pack.mjs

import assert from 'node:assert/strict';
import {
  windowFor, allowlistForEdition, deDash, validateFrontItems, goDeeperLabel, thingsHappenFor, deterministicFront,
} from '../lib/edition/pure.ts';
import { clusterStories, coverageLine } from '../lib/edition/cluster.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const it = (id, headline, extra = {}) => ({
  id, source: 'scan', headline, url: `https://outlet-${id}.com/story`, domain: `outlet-${id}.com`, tier: 2,
  contentKind: 'news', relevance: 0.7, publishedDate: '2026-09-23', summary: `Summary for ${id}.`,
  entities: [], tags: [], href: null, ...extra,
});

console.log('edition pack:');

// ---------------------------------------------------------------- windowFor

check('windowFor: a weekday closes at press time and opens at the previous press time', () => {
  // 2026-09-23 is a Wednesday; press time is 16:45 UTC.
  const w = windowFor('2026-09-23');
  assert.equal(w.to, '2026-09-23T16:45:00.000Z');
  assert.equal(w.from, '2026-09-22T16:45:00.000Z');
});

check('windowFor: Monday reaches back to Friday press time (covers the weekend)', () => {
  // 2026-09-21 is a Monday.
  const w = windowFor('2026-09-21');
  assert.equal(w.from, '2026-09-18T16:45:00.000Z'); // Friday
  assert.equal(w.to, '2026-09-21T16:45:00.000Z');
});

// ---------------------------------------------------------------- dedash

check('deDash: replaces an em dash with a comma', () => {
  assert.equal(deDash('one thing — another thing'), 'one thing, another thing');
  assert.equal(deDash('no dash here'), 'no dash here');
});

// ---------------------------------------------------------------- allowlistForEdition

function fixturePack() {
  const clusters = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com', url: 'https://wire.com/nvidia', tier: 1 }),
    it('c', 'EU delays AI Act enforcement for foundation models', { href: '/signals/sig-1' }),
  ]);
  return {
    day: '2026-09-23', windowFrom: '2026-09-23T00:00:00.000Z', windowTo: '2026-09-24T00:00:00.000Z',
    issueNumber: 3,
    numbers: { itemsRead: 3, outlets: 3, signalsPublished: 1, papersKept: 1, newTools: 0, clusters: clusters.length },
    clusters,
    thingsHappen: [{ headline: 'A minor story', url: 'https://minor.com/x', domain: 'minor.com', tier: 3, href: null }],
    companies: [{ companySlug: 'acme', companyName: 'Acme', facts: [{ fact: 'raised a round', valueText: '$10M', url: 'https://acme.com/press' }] }],
    papers: [{ id: 'p1', title: 'A paper', href: '/research/p1', whoCares: 'because', headlineClaim: 'a claim' }],
    tools: [{ slug: 'tool-1', name: 'Tool One', vendor: 'Acme', oneLiner: 'does things', href: '/tooling/tool-1' }],
    blindSpots: [{ headline: 'Something missed', url: 'https://missed.com/story' }],
    sources: [{ domain: 'outlet-a.com', tier: 2, count: 1 }],
    claimsTouched: [{ code: '2.3', statement: 'A claim statement.', href: '/claim/2.3', signalHrefs: ['/signals/sig-1'] }],
    generatedAt: '2026-09-23T12:00:00.000Z',
  };
}

check('allowlistForEdition: contains every item url/href in the pack', () => {
  const pack = fixturePack();
  const allow = allowlistForEdition(pack);
  for (const c of pack.clusters) {
    for (const item of c.items) {
      assert.ok(allow.hrefs.has(item.url), `missing item url ${item.url}`);
      if (item.href) assert.ok(allow.hrefs.has(item.href), `missing item href ${item.href}`);
    }
  }
  assert.ok(allow.hrefs.has(pack.thingsHappen[0].url));
  assert.ok(allow.hrefs.has(pack.papers[0].href));
  assert.ok(allow.hrefs.has(pack.tools[0].href));
  assert.ok(allow.hrefs.has(pack.claimsTouched[0].href));
  assert.ok(allow.hrefs.has(pack.claimsTouched[0].signalHrefs[0]));
  assert.ok(allow.hrefs.has(pack.companies[0].facts[0].url));
  assert.ok(allow.hrefs.has(pack.blindSpots[0].url));
  assert.equal(allow.tagByHref.get(pack.claimsTouched[0].href), '2.3');
});

check('allowlistForEdition: an href outside the pack is not in the allowlist', () => {
  const allow = allowlistForEdition(fixturePack());
  assert.ok(!allow.hrefs.has('https://not-in-pack.example.com/'));
});

// ---------------------------------------------------------------- validateFrontItems

check('validateFrontItems: keeps a valid item as-is', () => {
  const pack = fixturePack();
  const lead = pack.clusters[0];
  const out = validateFrontItems(pack.clusters, [
    { clusterId: lead.id, headline: 'A headline', why: 'It matters — a lot.', numbers: '', goDeeperHref: lead.lead.url },
  ], 6);
  assert.equal(out.length, 1);
  assert.equal(out[0].clusterId, lead.id);
  assert.equal(out[0].goDeeperHref, lead.lead.url);
  assert.equal(out[0].why, 'It matters, a lot.'); // em dash backstop applied
  assert.equal(out[0].numbers, null);
});

check('validateFrontItems: substitutes an invented href with the cluster lead href', () => {
  const pack = fixturePack();
  const lead = pack.clusters[0];
  const out = validateFrontItems(pack.clusters, [
    { clusterId: lead.id, headline: 'A headline', why: 'why', numbers: '', goDeeperHref: 'https://invented.example.com/not-real' },
  ], 6);
  assert.equal(out.length, 1);
  assert.equal(out[0].goDeeperHref, lead.lead.href ?? lead.lead.url);
  assert.equal(out[0].goDeeperLabel, goDeeperLabel(out[0].goDeeperHref));
});

check('validateFrontItems: drops an item naming a cluster outside the given list', () => {
  const pack = fixturePack();
  const out = validateFrontItems(pack.clusters, [
    { clusterId: 'not-a-real-cluster', headline: 'x', why: 'y', numbers: '', goDeeperHref: 'https://x.com' },
  ], 6);
  assert.equal(out.length, 0);
});

check('validateFrontItems: clamps to n even when the model returns more', () => {
  const pack = fixturePack();
  const raw = pack.clusters.map((c) => ({
    clusterId: c.id, headline: c.lead.headline, why: 'why', numbers: '', goDeeperHref: c.lead.href ?? c.lead.url,
  }));
  assert.ok(raw.length >= 2, 'fixture needs at least 2 clusters for this check');
  const out = validateFrontItems(pack.clusters, raw, 1);
  assert.equal(out.length, 1);
});

check('validateFrontItems: an empty or non-string headline falls back to the lead headline; non-string fields are ignored', () => {
  const pack = fixturePack();
  const lead = pack.clusters[0];
  const out = validateFrontItems(pack.clusters, [
    { clusterId: lead.id, headline: '', why: 42, numbers: ['not', 'a', 'string'], goDeeperHref: 7 },
  ], 6);
  assert.equal(out.length, 1);
  assert.equal(out[0].headline, lead.lead.headline);
  assert.equal(out[0].why, '');
  assert.equal(out[0].numbers, null);
  assert.equal(out[0].goDeeperHref, lead.lead.href ?? lead.lead.url);
  assert.equal(out[0].coverage, coverageLine(lead));
});

check('goDeeperLabel: labels an in-app href by its kind', () => {
  assert.equal(goDeeperLabel('/signals/abc'), 'Read the signal');
  assert.equal(goDeeperLabel('/research/abc'), 'Read the paper');
  assert.equal(goDeeperLabel('/tooling/abc'), 'Read the product page');
  assert.equal(goDeeperLabel('https://outlet.com/story'), 'Read the source');
});

// ---------------------------------------------------------------- deterministicFront

check('deterministicFront: the top n clusters in rank order, why = the lead summary first sentence, numbers never invented', () => {
  const pack = fixturePack();
  pack.clusters[0].lead.summary = 'First sentence here. Second sentence follows! Third?';
  pack.clusters[1].lead.summary = null;
  const out = deterministicFront(pack, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].clusterId, pack.clusters[0].id);
  assert.equal(out[0].headline, pack.clusters[0].lead.headline);
  assert.equal(out[0].why, 'First sentence here.');
  assert.equal(out[0].numbers, null);
  assert.equal(out[0].goDeeperHref, pack.clusters[0].lead.href ?? pack.clusters[0].lead.url);
  assert.equal(out[0].goDeeperLabel, goDeeperLabel(out[0].goDeeperHref));
  assert.equal(out[0].coverage, coverageLine(pack.clusters[0]));
  assert.equal(out[1].clusterId, pack.clusters[1].id);
  assert.equal(out[1].why, '');
});

check('deterministicFront: n is clamped to the cluster count, zero and negative give an empty front', () => {
  const pack = fixturePack();
  assert.equal(deterministicFront(pack, 50).length, pack.clusters.length);
  assert.deepEqual(deterministicFront(pack, 0), []);
  assert.deepEqual(deterministicFront(pack, -3), []);
});

check('deterministicFront: every goDeeperHref is inside the edition allowlist (the citation gate accepts the fallback front)', () => {
  const pack = fixturePack();
  const allow = allowlistForEdition(pack);
  for (const f of deterministicFront(pack, 7)) assert.ok(allow.hrefs.has(f.goDeeperHref), f.goDeeperHref);
});

// ---------------------------------------------------------------- thingsHappenFor

const TOPICS = [
  'Nvidia reports record data center revenue', 'EU delays AI Act enforcement', 'OpenAI raises new funding round',
  'Anthropic ships new model', 'Google expands Gemini to workspace', 'Microsoft cuts Azure prices',
  'Meta open-sources vision model', 'Apple delays Siri overhaul', 'Amazon builds new chip fab',
  'Fed governor warns on AI credit risk', 'UK regulator opens cloud probe', 'Tesla robotaxi pilot expands',
  'Salesforce agent platform launch', 'Oracle signs sovereign cloud deal', 'Intel foundry lands customer',
  'AMD guides above consensus', 'TSMC raises capex outlook', 'SoftBank plans chip venture',
  'Mistral partners with telecom', 'Cohere wins bank contract', 'Databricks acquires startup',
  'Snowflake reports slower growth', 'Palantir extends defense deal', 'Stripe adds agent payments',
  'Visa pilots agent commerce', 'Mastercard tokenizes agent flows', 'JPMorgan expands AI rollout',
  'Goldman automates filings', 'Citi retrains staff on AI', 'HSBC trims branch network',
];
const bigClusters = clusterStories(TOPICS.map((h, i) => it(`t${i}`, h)));

check('thingsHappenFor: excludes a named cluster and keeps the rest', () => {
  assert.ok(bigClusters.length >= 12, `fixture needs at least 12 clusters, got ${bigClusters.length}`);
  const skip = bigClusters[9];
  const out = thingsHappenFor(bigClusters, new Set([skip.id]));
  assert.equal(out.length, Math.min(23, bigClusters.length - 1));
  assert.ok(!out.some((t) => t.url === skip.lead.url));
});

check('thingsHappenFor: clamps to 23 in rank order with an empty exclude', () => {
  assert.equal(bigClusters.length, 30, `fixture expects 30 distinct clusters, got ${bigClusters.length}`);
  const out = thingsHappenFor(bigClusters, new Set());
  assert.equal(out.length, 23);
  for (let i = 0; i < 3; i++) assert.equal(out[i].url, bigClusters[i].lead.url);
});

check('thingsHappenFor: excluding the first 7 equals the slice(7, 30) projection', () => {
  const out = thingsHappenFor(bigClusters, new Set(bigClusters.slice(0, 7).map((c) => c.id)));
  const expected = bigClusters.slice(7, 30).map((c) => ({
    headline: c.lead.headline, url: c.lead.url, domain: c.lead.domain, tier: c.lead.tier, href: c.lead.href,
  }));
  assert.deepEqual(out, expected);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

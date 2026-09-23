// Pure tests for the daily edition's pack-side helpers (lib/edition/pack.ts):
// the citation allowlist, the front-item validator, the window computation,
// and the em-dash backstop. READ-ONLY, no DB: pack.ts's DB-touching read
// (buildEditionPack) is never called here, and its one DB import (lib/db.ts)
// is side-effect-free at module load (the pg.Pool is built lazily, inside
// q()/one(), not at import time) — see the file header comment in pack.ts
// for the full plain-Node-loadability discipline.
// Run: node scripts/test-edition-pack.mjs

import assert from 'node:assert/strict';
import { windowFor, allowlistForEdition, deDash, validateFrontItems, goDeeperLabel } from '../lib/edition/pack.ts';
import { clusterStories } from '../lib/edition/cluster.ts';

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
  assert.equal(w.fromDay, '2026-09-22');
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

check('goDeeperLabel: labels an in-app href by its kind', () => {
  assert.equal(goDeeperLabel('/signals/abc'), 'Read the signal');
  assert.equal(goDeeperLabel('/research/abc'), 'Read the paper');
  assert.equal(goDeeperLabel('https://outlet.com/story'), 'Read the source');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

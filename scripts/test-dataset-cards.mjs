// Tests for the Data Portal hub's card-shaping core (lib/datasets/cards.ts):
// per-dataset projection, the category-label guard, filtering (q/access/
// category), and count-line wording. READ-ONLY, no DB needed: cards.ts is
// pure and every import it makes is relative (not '@/...'), same discipline
// as scripts/test-reports-cards.mjs.
// Run: node scripts/test-dataset-cards.mjs

import assert from 'node:assert/strict';
import {
  toDatasetCard, filterCards, countLine, CATEGORY_LABELS,
} from '../lib/datasets/cards.ts';
import { DATASETS } from '../lib/datasets/registry.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('dataset cards:');

// ---------------------------------------------------------------- toDatasetCard

check('toDatasetCard: every registry dataset maps without throwing', () => {
  const cards = DATASETS.map(toDatasetCard);
  assert.equal(cards.length, DATASETS.length);
});

check('toDatasetCard: every registry category has a CATEGORY_LABELS entry', () => {
  const categories = new Set(DATASETS.map((d) => d.category));
  for (const cat of categories) {
    assert.ok(CATEGORY_LABELS[cat], `category "${cat}" has no label`);
  }
});

check('toDatasetCard: a category with no label throws (the page can never silently drop a dataset)', () => {
  const fake = {
    slug: 'made-up', title: 'Made up', description: 'desc',
    methodology: 'meth', category: 'not-a-real-category', formats: ['csv', 'json'],
    columns: [{ key: 'a', label: 'A', type: 'text', def: 'a column' }],
    build: async () => [],
  };
  assert.throws(() => toDatasetCard(fake));
});

check('toDatasetCard: shape, hrefs, formats uppercased', () => {
  const def = DATASETS.find((d) => d.slug === 'signals');
  const card = toDatasetCard(def);
  assert.equal(card.slug, 'signals');
  assert.equal(card.category, 'signals');
  assert.equal(card.categoryLabel, 'Signals');
  assert.equal(card.keyGated, false);
  assert.equal(card.heavy, false);
  assert.equal(card.columnCount, def.columns.length);
  assert.deepEqual(card.columnKeys, def.columns.map((c) => c.key));
  assert.deepEqual(card.formats, ['CSV', 'JSON']);
  assert.equal(card.href, '/datasets/signals');
  assert.equal(card.csvHref, '/api/datasets/signals');
  assert.equal(card.jsonHref, '/api/datasets/signals?format=json');
});

check('toDatasetCard: lensSlices true only for a dataset with filters.lens', () => {
  const lensCard = toDatasetCard(DATASETS.find((d) => d.slug === 'signals'));
  const plainCard = toDatasetCard(DATASETS.find((d) => d.slug === 'sources'));
  assert.equal(lensCard.lensSlices, true);
  assert.equal(plainCard.lensSlices, false);
});

check('toDatasetCard: filters lists only the pushdown names that are on', () => {
  const scan = toDatasetCard(DATASETS.find((d) => d.slug === 'external-scan'));
  assert.deepEqual(scan.filters, ['day']);
  const metricsDef = DATASETS.find((d) => d.slug === 'intel-metrics');
  const metrics = toDatasetCard(metricsDef);
  const expected = Object.keys(metricsDef.filters ?? {}).filter((k) => metricsDef.filters[k]);
  assert.deepEqual([...metrics.filters].sort(), expected.sort());
  const plain = toDatasetCard(DATASETS.find((d) => d.slug === 'sources'));
  assert.deepEqual(plain.filters, []);
});

check('toDatasetCard: keyGated and heavy carry through', () => {
  const card = toDatasetCard(DATASETS.find((d) => d.slug === 'articles-full-text'));
  assert.equal(card.keyGated, true);
  assert.equal(card.heavy, true);
});

// ---------------------------------------------------------------- filterCards

const allCards = DATASETS.map(toDatasetCard);

check('filterCards: q matches title case-insensitively', () => {
  const out = filterCards(allCards, { q: 'FEED', access: 'all', category: '' });
  assert.ok(out.some((c) => c.slug === 'signals'));
  assert.ok(out.every((c) => `${c.title} ${c.description} ${c.slug} ${c.columnKeys.join(' ')}`.toLowerCase().includes('feed')));
});

check('filterCards: q matches a column key', () => {
  const out = filterCards(allCards, { q: 'rigor_prior', access: 'all', category: '' });
  assert.ok(out.some((c) => c.slug === 'research-export'));
});

check('filterCards: q matches the slug', () => {
  const out = filterCards(allCards, { q: 'tooling-events', access: 'all', category: '' });
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'tooling-events');
});

check('filterCards: access "public" excludes key-gated datasets', () => {
  const out = filterCards(allCards, { q: '', access: 'public', category: '' });
  assert.ok(out.every((c) => !c.keyGated));
  assert.ok(out.length > 0);
});

check('filterCards: access "key" keeps only key-gated datasets', () => {
  const out = filterCards(allCards, { q: '', access: 'key', category: '' });
  assert.ok(out.every((c) => c.keyGated));
  assert.ok(out.length > 0);
});

check('filterCards: category is an exact match', () => {
  const out = filterCards(allCards, { q: '', access: 'all', category: 'scout' });
  assert.ok(out.length > 0);
  assert.ok(out.every((c) => c.category === 'scout'));
});

check('filterCards: q + access + category compose', () => {
  const out = filterCards(allCards, { q: 'registry', access: 'key', category: 'intel' });
  assert.ok(out.every((c) => c.category === 'intel' && c.keyGated));
  assert.ok(out.some((c) => c.slug === 'intel-companies'));
});

check('filterCards: empty category means every category', () => {
  const out = filterCards(allCards, { q: '', access: 'all', category: '' });
  assert.equal(out.length, allCards.length);
});

// ---------------------------------------------------------------- countLine

check('countLine: unfiltered wording carries the public/key split', () => {
  assert.equal(countLine(24, 24, 13, 11), '24 datasets · 13 public · 11 behind an access key');
});

check('countLine: filtered wording is "N of total match"', () => {
  assert.equal(countLine(24, 3, 13, 11), '3 of 24 datasets match');
});

check('countLine: filtered to zero still reads "N of total match"', () => {
  assert.equal(countLine(24, 0, 13, 11), '0 of 24 datasets match');
});

// ---------------------------------------------------------------- house style

check('house style: no em dash in any card string this module produces', () => {
  for (const cat of Object.values(CATEGORY_LABELS)) {
    assert.ok(!cat.includes('—'), `em dash in category label "${cat}"`);
  }
  assert.ok(!countLine(24, 24, 13, 11).includes('—'));
  assert.ok(!countLine(24, 3, 13, 11).includes('—'));
  for (const card of allCards) {
    assert.ok(!card.categoryLabel.includes('—'), `em dash in categoryLabel for "${card.slug}"`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

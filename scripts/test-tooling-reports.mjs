// Tests for the AI Tooling Monitor's report core (lib/tooling/report-core.ts):
// fit-band mapping, the citation allowlist, the plain-text prompt serializer
// (the STATISTICS block, the brief's INTERNAL CONTEXT block), feature-matrix
// novelty, and the entrants window. READ-ONLY, no DB needed: report-core.ts
// is pure. Node type stripping loads the .ts module directly.
// Run: node scripts/test-tooling-reports.mjs

import assert from 'node:assert/strict';
import {
  fitBand, toProductRef, allowlistForTooling, fmtToolingPack, landscapeStats, briefStats,
  featureRows, entrantsWindow,
} from '../lib/tooling/report-core.ts';

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

console.log('tooling report core:');

// ---------------------------------------------------------------- fitBand

check('fitBand: boundaries', () => {
  assert.equal(fitBand(null), null);
  assert.equal(fitBand(undefined), null);
  assert.equal(fitBand(80), 'strong');
  assert.equal(fitBand(95), 'strong');
  assert.equal(fitBand(79), 'solid');
  assert.equal(fitBand(60), 'solid');
  assert.equal(fitBand(59), 'marginal');
  assert.equal(fitBand(40), 'marginal');
  assert.equal(fitBand(39), 'weak');
  assert.equal(fitBand(0), 'weak');
});

// ---------------------------------------------------------------- toProductRef

function makeProduct(overrides = {}) {
  return {
    id: 'p1', name: 'Cursor', slug: 'cursor', vendor: 'Anysphere', vendor_domain: 'cursor.com',
    url: 'https://cursor.com', category: 'coding-assistants', secondary_categories: [],
    one_liner: 'An AI code editor.', description: null, target_buyer: [], deployment: ['cloud'],
    pricing_model: 'subscription', pricing_note: null, maturity: 'startup_growth', founded_year: 2022,
    hq: null, funding_note: null, notable_customers: [], integrations: [], compliance_claims: ['soc2'],
    models_used: [], features: ['autocomplete', 'chat'], feed_url: null, changelog_url: null,
    github_repo: null, feed_checked_at: null, status: 'cataloged', pinned: false, dossier: null,
    first_seen: '2026-01-01', last_seen: '2026-01-01', created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', agent_fit: 85,
    ...overrides,
  };
}

check('toProductRef: projects the pack-facing shape, tag by index, fit band', () => {
  const ref = toProductRef(makeProduct(), 2, 'Coding assistants');
  assert.equal(ref.tag, 'T3');
  assert.equal(ref.href, '/tooling/cursor');
  assert.equal(ref.category_name, 'Coding assistants');
  assert.equal(ref.fit_band, 'strong');
  assert.deepEqual(ref.deployment, ['cloud']);
  assert.deepEqual(ref.features, ['autocomplete', 'chat']);
});

check('toProductRef: nulls missing optionals rather than throwing', () => {
  const ref = toProductRef(makeProduct({ vendor: null, url: null, one_liner: null, agent_fit: null }), 0, 'Coding assistants');
  assert.equal(ref.tag, 'T1');
  assert.equal(ref.vendor, null);
  assert.equal(ref.url, null);
  assert.equal(ref.one_liner, null);
  assert.equal(ref.fit_band, null);
});

// ---------------------------------------------------------------- allowlist

check('allowlistForTooling: product hrefs tagged, urls allowed, no event leak on non-entrants', () => {
  const pack = {
    kind: 'tooling_landscape',
    products: [
      { ...refBase(), tag: 'T1', href: '/tooling/cursor', url: 'https://cursor.com' },
      { ...refBase(), tag: 'T2', href: '/tooling/windsurf', url: null },
    ],
  };
  const allow = allowlistForTooling(pack);
  assert.equal(allow.tagByHref.get('/tooling/cursor'), 'T1');
  assert.equal(allow.tagByHref.get('/tooling/windsurf'), 'T2');
  assert.ok(allow.hrefs.has('https://cursor.com'));
  assert.ok(allow.hrefs.has('/tooling/cursor'));
  assert.ok(allow.hrefs.has('/tooling/windsurf'));
});

check('allowlistForTooling: entrants pack also allows event urls', () => {
  const pack = {
    kind: 'tooling_entrants',
    products: [{ ...refBase(), tag: 'T1', href: '/tooling/cursor', url: null }],
    events: [{ product_slug: 'cursor', product_name: 'Cursor', date: '2026-09-01', kind: 'funding', title: 'Raised a round', url: 'https://news.example.com/x' }],
  };
  const allow = allowlistForTooling(pack);
  assert.ok(allow.hrefs.has('https://news.example.com/x'));
});

function refBase() {
  return {
    id: 'p', slug: 'p', name: 'P', vendor: null, href: '/tooling/p', url: null, tag: 'T1',
    one_liner: null, category: 'coding-assistants', category_name: 'Coding assistants',
    maturity: 'unknown', deployment: [], pricing_model: null, compliance_claims: [], features: [],
    first_seen: '2026-01-01', fit_band: null,
  };
}

// ---------------------------------------------------------------- fmtToolingPack

check('fmtToolingPack: landscape carries the STATISTICS block with exact counts', () => {
  const products = [
    { ...refBase(), tag: 'T1', name: 'Cursor', maturity: 'startup_growth', deployment: ['cloud'], pricing_model: 'subscription', features: ['autocomplete'] },
    { ...refBase(), tag: 'T2', name: 'Windsurf', maturity: 'startup_early', deployment: ['desktop'], pricing_model: 'freemium', features: ['autocomplete'] },
  ];
  const pack = {
    kind: 'tooling_landscape', category: 'coding-assistants', category_name: 'Coding assistants',
    dimensions: ['deployment'], audience: 'executive', products, stats: landscapeStats(products),
    builtAt: '2026-09-01T00:00:00Z',
  };
  const text = fmtToolingPack(pack);
  assert.ok(text.includes('STATISTICS (authoritative, computed in code; use these exact numbers):'));
  assert.ok(text.includes('2 products cataloged.'));
  assert.ok(text.includes('[T1](/tooling/p) "Cursor"'));
  assert.ok(text.includes('autocomplete (2)'));
});

check('fmtToolingPack: brief includes INTERNAL CONTEXT only when present', () => {
  const products = [{ ...refBase(), tag: 'T1', name: 'Cursor' }];
  const withContext = {
    kind: 'tooling_brief', capability: 'code review', category: null, products,
    internal: { ourContext: 'We run a legacy mainframe review process.' },
    stats: briefStats(products, false), builtAt: '2026-09-01T00:00:00Z',
  };
  const withoutContext = { ...withContext, internal: { ourContext: null } };
  const withText = fmtToolingPack(withContext);
  const withoutText = fmtToolingPack(withoutContext);
  assert.ok(withText.includes('INTERNAL CONTEXT (background from the requesting team'));
  assert.ok(withText.includes('We run a legacy mainframe review process.'));
  assert.ok(!withoutText.includes('INTERNAL CONTEXT'));
  assert.ok(withoutText.includes('STATISTICS (authoritative, computed in code; use these exact numbers):'));
});

check('fmtToolingPack: brief notes a topped-up market in the statistics line', () => {
  const products = [{ ...refBase(), tag: 'T1', name: 'Cursor' }];
  const pack = {
    kind: 'tooling_brief', capability: 'a very narrow capability', category: null, products,
    internal: { ourContext: null }, stats: briefStats(products, true), builtAt: '2026-09-01T00:00:00Z',
  };
  const text = fmtToolingPack(pack);
  assert.ok(text.includes('topped up beyond the exact capability match'));
});

check('fmtToolingPack: entrants formats the window, products, and tracked-product moves', () => {
  const products = [{ ...refBase(), tag: 'T1', name: 'Cursor', category: 'coding-assistants' }];
  const events = [{ product_slug: 'p', product_name: 'P', date: '2026-09-02', kind: 'funding', title: 'Raised a round', url: 'https://news.example.com/x' }];
  const pack = {
    kind: 'tooling_entrants', from: '2026-08-26', to: '2026-09-02', categories: [], products, events,
    stats: { entrants: 1, byCategory: { 'coding-assistants': 1 }, deepDived: 0, events: 1 },
    builtAt: '2026-09-02T00:00:00Z',
  };
  const text = fmtToolingPack(pack);
  assert.ok(text.includes('WEEKLY NEW ENTRANTS: 2026-08-26 to 2026-09-02.'));
  assert.ok(text.includes('P: funding "Raised a round" (https://news.example.com/x) on 2026-09-02'));
  assert.ok(text.includes('1 new entrants; 0 deep-dived; 1 tracked-product move this week.'));
});

check('fmtToolingPack: features formats the matrix with novelty flagged', () => {
  const products = [{ ...refBase(), tag: 'T1', name: 'Cursor' }];
  const features = featureRows({ features: [{ tag: 'autocomplete', count: 2, products: ['cursor', 'windsurf'] }, { tag: 'inline-chat', count: 1, products: ['cursor'] }] });
  const pack = {
    kind: 'tooling_features', category: 'coding-assistants', category_name: 'Coding assistants',
    focus: null, products, features, stats: { products: 1, features: 2, novel: 1 }, builtAt: '2026-09-01T00:00:00Z',
  };
  const text = fmtToolingPack(pack);
  assert.ok(text.includes('- autocomplete (2): cursor, windsurf'));
  assert.ok(text.includes('- inline-chat (1, novel): cursor'));
});

// ---------------------------------------------------------------- featureRows

check('featureRows: novel = carried by exactly one product', () => {
  const rows = featureRows({
    features: [
      { tag: 'a', count: 2, products: ['x', 'y'] },
      { tag: 'b', count: 1, products: ['x'] },
      { tag: 'c', count: 0, products: [] },
    ],
  });
  assert.deepEqual(rows.map((r) => r.novel), [false, true, false]);
});

// ---------------------------------------------------------------- entrantsWindow

check('entrantsWindow: 7-day window ending on the given day', () => {
  const { from, to } = entrantsWindow('2026-09-14');
  assert.equal(to, '2026-09-14');
  assert.equal(from, '2026-09-07');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

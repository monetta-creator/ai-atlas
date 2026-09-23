// Tests for the tooling table's pure core (lib/tooling/table-core.ts):
// toTableRow's projection, compareRows' sort semantics (numeric nulls-last,
// date/text/list ordering), and rowMatches' free-text search. READ-ONLY,
// no DB needed. Node type stripping loads the .ts module directly.
// Run: node scripts/test-tooling-table.mjs

import assert from 'node:assert/strict';
import { toTableRow, compareRows, rowMatches, TABLE_COLUMNS } from '../lib/tooling/table-core.ts';

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

console.log('tooling table core:');

function product(overrides = {}) {
  return {
    id: 'p1', name: 'Widgetron', slug: 'widgetron', vendor: 'Acme', vendor_domain: 'acme.example',
    url: 'https://acme.example', category: 'agents', secondary_categories: [], one_liner: 'Does widgets.',
    description: null, target_buyer: ['engineering', 'data'], deployment: ['saas', 'api'],
    pricing_model: 'per_seat', pricing_note: null, maturity: 'startup_early', founded_year: 2024,
    hq: null, funding_note: null, notable_customers: [], integrations: [],
    compliance_claims: ['soc2'], models_used: [], features: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    feed_url: null, changelog_url: null, github_repo: null, feed_checked_at: null,
    status: 'cataloged', pinned: false, dossier: null, first_seen: '2026-09-01', last_seen: '2026-09-20',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------- toTableRow

check('toTableRow: maps flat scalars and resolves category name', () => {
  const row = toTableRow(product(), 'Agent Platforms');
  assert.equal(row.id, 'p1');
  assert.equal(row.slug, 'widgetron');
  assert.equal(row.category, 'agents');
  assert.equal(row.categoryName, 'Agent Platforms');
  assert.equal(row.maturityLabel, 'Early stage startup');
});

check('toTableRow: features caps the cell list at 6 but keeps allFeatures whole', () => {
  const row = toTableRow(product(), 'Agent Platforms');
  assert.equal(row.features.length, 6);
  assert.equal(row.allFeatures.length, 7);
  assert.equal(row.featureCount, 7);
});

check('toTableRow: deploymentLabel humanizes and joins with middle dots', () => {
  const row = toTableRow(product(), 'Agent Platforms');
  assert.equal(row.deploymentLabel, 'SaaS · API');
});

check('toTableRow: pricingLabel is null when pricing_model is null', () => {
  const row = toTableRow(product({ pricing_model: null }), 'Agent Platforms');
  assert.equal(row.pricing, null);
  assert.equal(row.pricingLabel, null);
});

check('toTableRow: guest row (no agent_fit/agent_scores) yields fit/fitBand/scores null', () => {
  const row = toTableRow(product(), 'Agent Platforms');
  assert.equal(row.fit, null);
  assert.equal(row.fitBand, null);
  assert.equal(row.scores, null);
});

check('toTableRow: portal row carries fit, fitBand, and the five dims', () => {
  const row = toTableRow(
    product({ agent_fit: 82, agent_scores: { relevance: 5, enterprise_readiness: 4, differentiation: 3, momentum: 4, build_difficulty: 2 } }),
    'Agent Platforms'
  );
  assert.equal(row.fit, 82);
  assert.equal(row.fitBand, 'strong');
  assert.equal(row.scores.relevance, 5);
});

// ---------------------------------------------------------------- compareRows

check('compareRows: numeric column sorts ascending with nulls last', () => {
  const rows = [
    toTableRow(product({ id: 'a', agent_fit: null }), 'C'),
    toTableRow(product({ id: 'b', agent_fit: 50 }), 'C'),
    toTableRow(product({ id: 'c', agent_fit: 10 }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'fit', 'asc'));
  assert.deepEqual(sorted.map((r) => r.id), ['c', 'b', 'a']);
});

check('compareRows: numeric column keeps nulls last even sorting descending', () => {
  const rows = [
    toTableRow(product({ id: 'a', agent_fit: null }), 'C'),
    toTableRow(product({ id: 'b', agent_fit: 50 }), 'C'),
    toTableRow(product({ id: 'c', agent_fit: 10 }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'fit', 'desc'));
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});

check('compareRows: date column (firstSeen) sorts chronologically by string', () => {
  const rows = [
    toTableRow(product({ id: 'a', first_seen: '2026-09-10' }), 'C'),
    toTableRow(product({ id: 'b', first_seen: '2026-01-05' }), 'C'),
    toTableRow(product({ id: 'c', first_seen: '2026-06-01' }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'firstSeen', 'asc'));
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});

check('compareRows: list column (deployment) sorts by length then first item', () => {
  const rows = [
    toTableRow(product({ id: 'a', deployment: ['saas', 'api', 'vpc'] }), 'C'),
    toTableRow(product({ id: 'b', deployment: [] }), 'C'),
    toTableRow(product({ id: 'c', deployment: ['api'] }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'deployment', 'asc'));
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});

check('compareRows: text column (name) localeCompares case-insensitively enough for plain ascii', () => {
  const rows = [
    toTableRow(product({ id: 'a', name: 'Zeta' }), 'C'),
    toTableRow(product({ id: 'b', name: 'Alpha' }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'name', 'asc'));
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'a']);
  const desc = [...rows].sort((x, y) => compareRows(x, y, 'name', 'desc'));
  assert.deepEqual(desc.map((r) => r.id), ['a', 'b']);
});

check('compareRows: score-dimension column reads through row.scores', () => {
  const rows = [
    toTableRow(product({ id: 'a', agent_scores: { relevance: 2, enterprise_readiness: 1, differentiation: 1, momentum: 1, build_difficulty: 1 } }), 'C'),
    toTableRow(product({ id: 'b', agent_scores: { relevance: 5, enterprise_readiness: 1, differentiation: 1, momentum: 1, build_difficulty: 1 } }), 'C'),
  ];
  const sorted = [...rows].sort((x, y) => compareRows(x, y, 'relevance', 'desc'));
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'a']);
});

// ---------------------------------------------------------------- rowMatches

check('rowMatches: matches a visible text cell case-insensitively', () => {
  const row = toTableRow(product({ name: 'Widgetron' }), 'Agent Platforms');
  assert.equal(rowMatches(row, 'widget', ['name']), true);
  assert.equal(rowMatches(row, 'zzz', ['name']), false);
});

check('rowMatches: matches a list cell by any member', () => {
  const row = toTableRow(product({ compliance_claims: ['soc2', 'hipaa'] }), 'Agent Platforms');
  assert.equal(rowMatches(row, 'hipaa', ['compliance']), true);
});

check('rowMatches: falls back to one-liner/slug/url even outside the visible key set', () => {
  const row = toTableRow(product({ one_liner: 'Automates widget QA.' }), 'Agent Platforms');
  assert.equal(rowMatches(row, 'automates', []), true);
  assert.equal(rowMatches(row, 'widgetron', []), true);
  assert.equal(rowMatches(row, 'acme.example', []), true);
});

check('rowMatches: empty needle matches everything', () => {
  const row = toTableRow(product(), 'Agent Platforms');
  assert.equal(rowMatches(row, '', []), true);
  assert.equal(rowMatches(row, '   ', []), true);
});

check('TABLE_COLUMNS: portal-only columns are flagged, public columns are not', () => {
  const fit = TABLE_COLUMNS.find((c) => c.key === 'fit');
  const name = TABLE_COLUMNS.find((c) => c.key === 'name');
  assert.equal(fit.portal, true);
  assert.equal(name.portal, undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

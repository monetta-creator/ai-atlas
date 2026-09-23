// Pure tests for lib/format.ts, the shared label/date helpers every surface
// renders through. No DB: format.ts has only type imports, so plain-Node type
// stripping loads it directly. Pins the two behaviors a page cannot catch in a
// UTC CI box: a bare 'YYYY-MM-DD' (run days, report scope_to) formats in UTC
// so a US zone does not show the day before, while a full timestamp still
// formats in the viewer's zone; and confidenceBand mirrors Postgres conf_label().
// Run: node scripts/test-format.mjs

import assert from 'node:assert/strict';
import {
  dateLabel, formatDateRange, confidenceBand, confidenceText, heatFill, featureLabel,
  SHEET_KIND_LABEL, SHEET_SECTION_TITLES,
} from '../lib/format.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

console.log('format:');

// Node re-reads TZ on assignment, so the zone can be pinned per check. Every
// check that formats a date sets it explicitly and restores it afterwards.
function inZone(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

// ---------------------------------------------------------------- dateLabel

check('dateLabel: a bare YYYY-MM-DD formats in UTC even in a US zone (the day-early bug)', () => {
  inZone('America/Los_Angeles', () => {
    assert.equal(dateLabel('2026-09-23'), 'Sep 23, 2026');
    assert.equal(dateLabel('2026-01-01'), 'Jan 1, 2026');
  });
  inZone('Pacific/Auckland', () => assert.equal(dateLabel('2026-09-23'), 'Sep 23, 2026'));
  inZone('UTC', () => assert.equal(dateLabel('2026-09-23'), 'Sep 23, 2026'));
});

check('dateLabel: a full timestamp formats in the viewer zone (not forced to UTC)', () => {
  inZone('America/Los_Angeles', () => assert.equal(dateLabel('2026-09-23T03:00:00.000Z'), 'Sep 22, 2026'));
  inZone('UTC', () => assert.equal(dateLabel('2026-09-23T03:00:00.000Z'), 'Sep 23, 2026'));
});

check('dateLabel: accepts a Date, returns null for null and unparseable input', () => {
  inZone('UTC', () => {
    assert.equal(dateLabel(new Date('2026-09-23T12:00:00Z')), 'Sep 23, 2026');
    assert.equal(dateLabel(null), null);
    assert.equal(dateLabel('not a date'), null);
    assert.equal(dateLabel(''), null);
  });
});

// ---------------------------------------------------------------- formatDateRange

check('formatDateRange: same month, same year, cross-year, and the raw fallback', () => {
  assert.equal(formatDateRange('2026-06-01', '2026-06-06'), 'Jun 1–6, 2026');
  assert.equal(formatDateRange('2026-06-01', '2026-07-02'), 'Jun 1 – Jul 2, 2026');
  assert.equal(formatDateRange('2025-12-29', '2026-01-04'), 'Dec 29, 2025 – Jan 4, 2026');
  assert.equal(formatDateRange('garbage', '2026-01-04'), 'garbage – 2026-01-04');
});

// ---------------------------------------------------------------- confidence

check('confidenceBand: mirrors conf_label() thresholds at the boundaries', () => {
  assert.equal(confidenceBand(null), null);
  assert.equal(confidenceBand(0), 'thin');
  assert.equal(confidenceBand(0.39), 'thin');
  assert.equal(confidenceBand(0.4), 'contested');
  assert.equal(confidenceBand(0.5), 'contested');
  assert.equal(confidenceBand(0.59), 'contested');
  assert.equal(confidenceBand(0.6), 'leaning');
  assert.equal(confidenceBand(0.79), 'leaning');
  assert.equal(confidenceBand(0.8), 'settled');
  assert.equal(confidenceBand(1), 'settled');
});

check('confidenceText: capitalizes a label, en-dash placeholder for null', () => {
  assert.equal(confidenceText('contested'), 'Contested');
  assert.equal(confidenceText(null), '–');
});

check('heatFill: 0 chips for null, otherwise 1..5 rounded from the confidence', () => {
  assert.equal(heatFill(null), 0);
  assert.equal(heatFill(0), 1);
  assert.equal(heatFill(0.5), 3);
  assert.equal(heatFill(1), 5);
  assert.equal(heatFill(1.4), 5);
});

// ---------------------------------------------------------------- labels

check('featureLabel: known slugs map, unknown slugs title-case their own text', () => {
  assert.equal(featureLabel('edition_front'), 'Edition front');
  assert.equal(featureLabel('portal_ask_classify'), 'Ask classifier · portal');
  assert.equal(featureLabel('some_new_feature'), 'Some New Feature');
});

check('SHEET_KIND_LABEL and SHEET_SECTION_TITLES stay exhaustive over the same kind set', () => {
  assert.deepEqual(Object.keys(SHEET_SECTION_TITLES).sort(), Object.keys(SHEET_KIND_LABEL).sort());
  assert.equal(SHEET_KIND_LABEL.edition, 'Daily edition');
  for (const k of Object.keys(SHEET_KIND_LABEL)) assert.ok(!SHEET_KIND_LABEL[k].includes('—'), k);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

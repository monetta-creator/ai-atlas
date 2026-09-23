// Tests for the Report Portal's card-shaping core (lib/reports/cards.ts):
// per-family projection (sheet/period/thesis), kind filtering (including
// the tooling_* prefix match and the admin-only drafts filter), search, and
// pagination clamping. READ-ONLY, no DB needed: cards.ts is pure and every
// import it makes is relative (not '@/...'), so plain-Node type stripping
// can load it directly, same discipline as scripts/test-tooling-reports.mjs.
// Run: node scripts/test-reports-cards.mjs

import assert from 'node:assert/strict';
import { dateLabel } from '../lib/format.ts';
import {
  toSheetCard, toPeriodCard, toThesisCard, filterCards, paginate, sortCards,
  REPORT_KIND_FILTERS, DRAFTS_FILTER, toDeckCard } from '../lib/reports/cards.ts';
import { DECKS, visibleDecks } from '../lib/reports/decks.ts';

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

console.log('report cards:');

// ---------------------------------------------------------------- toSheetCard

function makeClaimMeta(overrides = {}) {
  return {
    id: 'sheet-1', kind: 'claim', subject: '4.2', title: 'Claim tear sheet: 4.2',
    scope_from: null, scope_to: null, is_published: true, generated_at: '2026-09-10T12:00:00Z',
    abstract: 'The bottom line.',
    stats: { evidence: { total: 5, supports: 3, contradicts: 1, neutral: 1, oneSided: false }, signals: { total: 4 } },
    health: null,
    ...overrides,
  };
}

check('toSheetCard: kindLabel, hrefs, evidence chip', () => {
  const card = toSheetCard(makeClaimMeta());
  assert.equal(card.kindLabel, 'Claim tear sheet');
  assert.equal(card.href, '/reports/sheet/sheet-1');
  assert.equal(card.pdfHref, '/reports/sheet/sheet-1/pdf');
  assert.equal(card.family, 'sheet');
  assert.equal(card.isPublished, true);
  assert.ok(card.chips.some((c) => c.includes('evidence')));
});

check('toSheetCard: draft is not published', () => {
  const card = toSheetCard(makeClaimMeta({ is_published: false }));
  assert.equal(card.isPublished, false);
});

check('toSheetCard: edition reads on the blotter, subject is the day', () => {
  const card = toSheetCard(makeClaimMeta({
    id: 'ed-1', kind: 'edition', subject: null, scope_from: '2026-09-22', scope_to: '2026-09-23',
    title: 'Daily edition, Sep 23',
  }));
  assert.equal(card.href, '/blotter/2026-09-23');
  assert.equal(card.subject, 'Sep 23, 2026');
  // The edition's PDF is the blotter deck PDF, not the generic sheet PDF.
  assert.equal(card.pdfHref, '/blotter/2026-09-23/pdf');
  assert.ok(REPORT_KIND_FILTERS.find((f) => f.key === 'edition').match(card));
  assert.ok(!REPORT_KIND_FILTERS.find((f) => f.key === 'tooling').match(card));
});

check('toSheetCard: an edition row with no scope_to falls back to the sheet view and a "Today" subject', () => {
  const card = toSheetCard(makeClaimMeta({
    id: 'ed-2', kind: 'edition', subject: null, scope_from: null, scope_to: null, title: 'Daily edition',
  }));
  assert.equal(card.href, '/reports/sheet/ed-2');
  assert.equal(card.pdfHref, '/reports/sheet/ed-2/pdf');
  assert.equal(card.subject, 'Today');
});

check('toSheetCard: non-edition kinds keep the generic sheet PDF route', () => {
  const card = toSheetCard(makeClaimMeta({ id: 'r-1', kind: 'roundup', scope_from: '2026-09-14', scope_to: '2026-09-18' }));
  assert.equal(card.pdfHref, '/reports/sheet/r-1/pdf');
});

check('toSheetCard: scope line reflects a bounded window', () => {
  const card = toSheetCard(makeClaimMeta({ scope_from: '2026-01-01', scope_to: '2026-02-01' }));
  assert.equal(card.metaLines[0], 'Scope: 2026-01-01 to 2026-02-01');
});

// ---------------------------------------------------------------- toPeriodCard

check('toPeriodCard: subject from lens labels', () => {
  const card = toPeriodCard({
    id: 'p1', title: 'Period report', date_from: '2026-09-01', date_to: '2026-09-07',
    lenses: ['market', 'labor'], generated_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z',
  });
  assert.equal(card.kind, 'period');
  assert.equal(card.subject, 'Market & Valuation, Labor & Knowledge Work');
  assert.equal(card.href, '/reports/p1');
  assert.equal(card.pdfHref, '/reports/p1/pdf');
  assert.equal(card.isPublished, true);
});

// ---------------------------------------------------------------- toThesisCard

check('toThesisCard: chips carry matched + stance split', () => {
  const card = toThesisCard({
    report_id: 't1', thesis_id: 'th1', title: 'A thesis', statement: 'The statement.',
    generated_at: '2026-09-05T00:00:00Z', matched: 12, supports: 7, contradicts: 3, mixed: 2,
  });
  assert.equal(card.kind, 'thesis');
  assert.equal(card.href, '/thesis-report/t1');
  assert.equal(card.pdfHref, '/thesis-report/t1/pdf');
  assert.deepEqual(card.chips, ['12 signals matched', '7 support / 3 contradict / 2 mixed']);
});

// ---------------------------------------------------------------- filterCards

check('filterCards: q matches title case-insensitively', () => {
  const cards = [
    toSheetCard(makeClaimMeta({ id: 's1', title: 'Compute moats and the market' })),
    toSheetCard(makeClaimMeta({ id: 's2', title: 'Unrelated title' })),
  ];
  const out = filterCards(cards, { q: 'MOAT', kind: 'all', admin: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
});

check('filterCards: kind "tooling" matches tooling_entrants', () => {
  const cards = [
    toSheetCard(makeClaimMeta({ id: 's1', kind: 'tooling_entrants', title: 'New entrants' })),
    toSheetCard(makeClaimMeta({ id: 's2', kind: 'claim', title: 'A claim sheet' })),
  ];
  const out = filterCards(cards, { q: '', kind: 'tooling', admin: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
});

check('filterCards: drafts filter ignored for a non-admin viewer', () => {
  const cards = [
    toSheetCard(makeClaimMeta({ id: 's1', is_published: false })),
    toSheetCard(makeClaimMeta({ id: 's2', is_published: true })),
  ];
  const out = filterCards(cards, { q: '', kind: 'drafts', admin: false });
  // Not an admin: 'drafts' isn't a recognized filter for them, so nothing is excluded.
  assert.equal(out.length, 2);
});

check('filterCards: drafts filter applies for an admin viewer', () => {
  const cards = [
    toSheetCard(makeClaimMeta({ id: 's1', is_published: false })),
    toSheetCard(makeClaimMeta({ id: 's2', is_published: true })),
  ];
  const out = filterCards(cards, { q: '', kind: 'drafts', admin: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
});

check('toSheetCard: the company intel deck reads on /intel/deck/<day>, is portal-only, and chips its day counts', () => {
  const c = toSheetCard({
    id: 'd1', kind: 'intel_deck', subject: null, title: 'Company intel, Sep 23',
    scope_from: '2026-09-22', scope_to: '2026-09-23', is_published: true, generated_at: '2026-09-23T16:20:00Z',
    abstract: null, stats: { companies: 12, movers: 3, quiet: 9, items: 40, facts: 31 },
  });
  assert.equal(c.href, '/intel/deck/2026-09-23');
  assert.equal(c.pdfHref, '/intel/deck/2026-09-23/pdf');
  assert.equal(c.access, 'portal');
  assert.deepEqual(c.chips, ['12 companies', '3 moves', '9 quiet']);
  assert.equal(c.kindLabel, 'Company intel deck');
  assert.equal(c.subject, dateLabel('2026-09-23'));
});

check('REPORT_KIND_FILTERS / DRAFTS_FILTER: keys are stable and in order', () => {
  assert.deepEqual(
    REPORT_KIND_FILTERS.map((f) => f.key),
    ['all', 'claim', 'bridge', 'lens', 'atlas', 'roundup', 'edition', 'intel_deck', 'tooling', 'period', 'thesis', 'deck']
  );
  assert.equal(DRAFTS_FILTER.key, 'drafts');
});

// ---------------------------------------------------------------- paginate

check('paginate: clamps below range to page 1', () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const p = paginate(items, 0, 15);
  assert.equal(p.page, 1);
  assert.equal(p.items[0], 0);
});

check('paginate: clamps above range to the last page', () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const p = paginate(items, 99, 15);
  assert.equal(p.page, 3);
  assert.equal(p.pages, 3);
  assert.equal(p.items.length, 10);
});

check('paginate: pages is at least 1 for an empty set', () => {
  const p = paginate([], 5, 15);
  assert.equal(p.pages, 1);
  assert.equal(p.page, 1);
  assert.equal(p.total, 0);
  assert.deepEqual(p.items, []);
});

// ---------------------------------------------------------------- sortCards

check('sortCards: newest sortDate first, title tiebreaks', () => {
  const a = toThesisCard({ report_id: 'a', thesis_id: 'ta', title: 'B title', statement: 's',
    generated_at: '2026-09-01T00:00:00Z', matched: 1, supports: 1, contradicts: 0, mixed: 0 });
  const b = toThesisCard({ report_id: 'b', thesis_id: 'tb', title: 'A title', statement: 's',
    generated_at: '2026-09-01T00:00:00Z', matched: 1, supports: 1, contradicts: 0, mixed: 0 });
  const c = toThesisCard({ report_id: 'c', thesis_id: 'tc', title: 'C title', statement: 's',
    generated_at: '2026-09-05T00:00:00Z', matched: 1, supports: 1, contradicts: 0, mixed: 0 });
  const sorted = sortCards([a, b, c]);
  assert.deepEqual(sorted.map((x) => x.id), ['c', 'b', 'a']);
});

// ---------------------------------------------------------------- decks

check('toDeckCard: undated deck family with its own kind label and access', () => {
  const c = toDeckCard(DECKS[0]);
  assert.equal(c.family, 'deck');
  assert.equal(c.kind, 'deck');
  assert.equal(c.kindLabel, '16:9 deck');
  assert.equal(c.sortDate, '');
  assert.equal(c.href, '/costs/deck');
  assert.equal(c.pdfHref, '/costs/deck/pdf');
  assert.equal(c.access, 'admin');
  assert.ok(c.chips.includes('admin only'));
});

check('visibleDecks: guests get only public decks, admins get all', () => {
  assert.ok(visibleDecks(false).every((d) => d.access === 'public'));
  assert.equal(visibleDecks(true).length, DECKS.length);
  assert.ok(visibleDecks(false).length >= 1);
});

check('sortCards: decks sort after every dated report, in registry order', () => {
  const dated = toThesisCard({ report_id: 'x', thesis_id: 't', title: 'Old', statement: 's',
    generated_at: '2020-01-01T00:00:00Z', matched: 1, supports: 1, contradicts: 0, mixed: 0 });
  const decks = DECKS.map(toDeckCard);
  const sorted = sortCards([...decks, dated]);
  assert.equal(sorted[0].id, 'x');
  assert.deepEqual(sorted.slice(1).map((c) => c.id), DECKS.map((d) => d.id));
});

check('filterCards: the deck chip isolates decks and q matches a deck title', () => {
  const cards = [...DECKS.map(toDeckCard)];
  assert.equal(filterCards(cards, { q: '', kind: 'deck', admin: true }).length, DECKS.length);
  assert.equal(filterCards(cards, { q: '1000x', kind: 'all', admin: true }).length, 1);
  assert.equal(filterCards(cards, { q: '', kind: 'thesis', admin: true }).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

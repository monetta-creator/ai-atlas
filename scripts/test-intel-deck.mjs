// Tests for lib/intel/deck-pure.ts (the company intel deck's pure half).
// No DB, no model. Run: node scripts/test-intel-deck.mjs
import assert from 'node:assert/strict';
import {
  INTEL_DECK_PRESS_UTC, deckWindowFor, scoreCompany, rankMovers, quietCompanies, allowlistForCompany,
  allowlistForDeck, sentenceSegments, fmtMetricValue, fmtDelta, humanizeCode, buildIntelDeck,
} from '../lib/intel/deck-pure.ts';
import { windowFor } from '../lib/edition/pure.ts';
import { enforceCitations } from '../lib/citations.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const company = (slug, over = {}) => ({
  slug, name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), tier: 'fintech', domain: `${slug}.com`, ticker: null, logoDataUri: null,
  items: [], facts: [], filings: [], metrics: [], score: 0, ...over,
});
const item = (id, sig = 0.7) => ({ id, headline: `Headline ${id}`, url: `https://news.example/${id}`, domain: 'news.example', sourceTier: 2, publishedDate: '2026-09-22', significance: sig, docType: 'news', summary: null });
const fact = (id, url = `https://news.example/${id}`) => ({ id, dimension: 'products', fact: `Fact ${id} about a product launch`, valueText: null, asOf: '2026-09-22', url });

check('deckWindowFor: 16:20 UTC press-to-press, Monday reaches back to Friday, edition default unchanged', () => {
  assert.equal(INTEL_DECK_PRESS_UTC, '16:20:00');
  const w = deckWindowFor('2026-09-23'); // Wednesday
  assert.equal(w.to, '2026-09-23T16:20:00.000Z');
  assert.equal(w.from, '2026-09-22T16:20:00.000Z');
  const mon = deckWindowFor('2026-09-21');
  assert.equal(mon.from, '2026-09-18T16:20:00.000Z');
  assert.equal(windowFor('2026-09-23').to, '2026-09-23T16:45:00.000Z');
});

check('scoreCompany: significance sum + 0.5/fact + 1.0/filing + 1.5/metric, unscored items count 0.5', () => {
  const c = company('a', { items: [item('1', 0.9), { ...item('2'), significance: null }], facts: [fact('f1')], filings: [{ id: 'x', headline: '10-Q', url: 'https://sec.example/x', publishedDate: null }], metrics: [{ code: 'revenue', label: 'Revenue', period: 'Q2 2026', value: 1, unit: 'USD', prevValue: null, prevPeriod: null, deltaPct: null, source: 'edgar_xbrl' }] });
  assert.equal(scoreCompany(c), 0.9 + 0.5 + 0.5 + 1.0 + 1.5);
});

check('rankMovers: score desc then slug, top n, headline from the top item', () => {
  const cs = [company('b', { score: 2, items: [item('b1')] }), company('a', { score: 2, items: [item('a1')] }), company('c', { score: 5, items: [item('c1')] }), company('d', { score: 1 })];
  const m = rankMovers(cs, 3);
  assert.deepEqual(m.map((x) => x.slug), ['c', 'a', 'b']);
  assert.equal(m[0].headline, 'Headline c1');
});

check('quietCompanies: active non-self companies with nothing in the window, sorted by name; self never appears', () => {
  const active = [
    { slug: 'zeta', name: 'Zeta', tier: 'fintech', domain: 'zeta.com' },
    { slug: 'me', name: 'Own Company', tier: 'self', domain: 'me.com' },
    { slug: 'alpha', name: 'Alpha Bank', tier: 'consumer_bank', domain: 'alpha.com' },
    { slug: 'busy', name: 'Busy', tier: 'fintech', domain: null },
  ];
  const q = quietCompanies(active, new Set(['busy']));
  assert.deepEqual(q.map((x) => x.slug), ['alpha', 'zeta']);
});

check('allowlists: a company sentence may cite only its own items, fact provenance, and filings', () => {
  const c = company('a', { items: [item('1')], facts: [fact('f1', 'https://news.example/f1')], filings: [{ id: 'x', headline: '10-Q', url: 'https://sec.example/x', publishedDate: null }] });
  const allow = allowlistForCompany(c);
  assert.deepEqual([...allow.hrefs].sort(), ['https://news.example/1', 'https://news.example/f1', 'https://sec.example/x']);
  const gated = enforceCitations('<p>See <a href="https://news.example/1">the item</a> and <a href="https://evil.example/x">not this</a>.</p>', allow);
  assert.ok(gated.html.includes('https://news.example/1'));
  assert.ok(!gated.html.includes('evil.example'));
  // The surviving link must COUNT as a citation (the generator drops a sentence with cited.length 0).
  assert.deepEqual(gated.cited, ['https://news.example/1']);
  assert.deepEqual(gated.dropped, ['https://evil.example/x']);
  const deckAllow = allowlistForDeck({ companies: [c, company('b', { items: [item('9')] })] });
  assert.ok(deckAllow.hrefs.has('https://news.example/9'));
});

check('sentenceSegments: gated html becomes text + link segments; entities decoded; empty -> null', () => {
  const segs = sentenceSegments('<p>Alpha <a href="https://news.example/1">launched a card</a> &amp; grew.</p>');
  assert.deepEqual(segs, [{ text: 'Alpha ' }, { text: 'launched a card', href: 'https://news.example/1' }, { text: ' & grew.' }]);
  assert.equal(sentenceSegments(null), null);
  assert.equal(sentenceSegments('<p>  </p>'), null);
});

check('formatting: metric values, deltas, code labels', () => {
  assert.equal(fmtMetricValue(12_300_000_000, 'USD'), '$12B');
  assert.equal(fmtMetricValue(1_230_000_000, 'USD'), '$1.2B');
  assert.equal(fmtMetricValue(340_000_000, 'USD'), '$340M');
  assert.equal(fmtMetricValue(-2_500_000, 'USD'), '-$2.5M');
  assert.equal(fmtMetricValue(2.314, 'USD/share'), '$2.31');
  assert.equal(fmtMetricValue(1234, null), '1234');
  assert.equal(fmtDelta(12.345), '+12.3%');
  assert.equal(fmtDelta(-3), '-3.0%');
  assert.equal(fmtDelta(null), null);
  assert.equal(humanizeCode('provision_credit_losses'), 'Provision credit losses');
});

check('buildIntelDeck: slide sequence, one company slide each, relative hrefs made absolute, no self, no em dash', () => {
  const a = company('alpha-bank', { tier: 'consumer_bank', ticker: 'ALB', items: [item('1', 0.9)], facts: [fact('f1')], score: 1.9 });
  const b = company('beta-pay', { items: [item('2', 0.4)], score: 0.4, logoDataUri: 'data:image/png;base64,AAAA' });
  const pack = {
    day: '2026-09-23', windowFrom: '2026-09-22T16:20:00.000Z', windowTo: '2026-09-23T16:20:00.000Z', issueNumber: 4,
    numbers: { companies: 2, quiet: 1, items: 2, facts: 1, filings: 0, metrics: 0, outlets: 1 },
    stats: { companies: 2, movers: 2, quiet: 1, items: 2, facts: 1 },
    companies: [a, b], quiet: [{ slug: 'gamma', name: 'Gamma', tier: 'wildcard', domain: null }],
    movers: rankMovers([a, b], 3), generatedAt: '2026-09-23T16:21:00.000Z',
  };
  const narrative = { sentences: [{ slug: 'alpha-bank', html: '<p>Alpha <a href="/signals/abc">moved</a> on <a href="https://news.example/1">cards</a>.</p>' }], frontHtml: null, model: 'test', dropped: [] };
  const deck = buildIntelDeck({ id: 'd', scope_to: '2026-09-23', is_published: true, generated_at: pack.generatedAt, pack, narrative }, 'https://atlas.example');
  const kinds = deck.slides.map((s) => s.kind);
  assert.deepEqual(kinds, ['title', 'stat-grid', 'bullets', 'company', 'company', 'bullets', 'divider']);
  const alpha = deck.slides[3];
  assert.equal(alpha.title, 'Alpha Bank');
  assert.equal(alpha.tier, 'Consumer bank');
  assert.equal(alpha.logoSrc, 'https://www.google.com/s2/favicons?domain=alpha-bank.com&sz=64');
  assert.deepEqual(alpha.sentence, [{ text: 'Alpha ' }, { text: 'moved', href: 'https://atlas.example/signals/abc' }, { text: ' on ' }, { text: 'cards', href: 'https://news.example/1' }, { text: '.' }]);
  assert.equal(deck.slides[4].logoDataUri, 'data:image/png;base64,AAAA');
  assert.equal(deck.slides[4].sentence, null);
  const text = JSON.stringify(deck);
  assert.ok(!text.includes('—'), 'no em dash');
  assert.ok(!/"self"/.test(text));
  assert.equal(deck.slides[5].bullets[0].lead, 'Gamma');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Plain-Node checks over Savant's figure vocabulary: validation against the
// allow-list, the caps, block splitting and interleaving, and the layouts'
// bounds. Run: node scripts/test-savant-figures.mjs
import assert from 'node:assert/strict';
import { collectCitedSources, breakableUrl, displayUrl, hostOf, fallbackLabel } from '../lib/savant/sources-core.ts';
import {
  validateFigures, splitBlocks, interleave, layoutFigure, wrapText, domainOf, MAX_FIGURES_PER_ISSUE, FIG_W,
} from '../lib/savant/figures-core.ts';

let passed = 0; let failed = 0;
const test = (name, fn) => { try { fn(); passed += 1; console.log(`  ok  ${name}`); } catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message}`); } };

const allowed = new Set(['/tooling/acme', '/tooling/beta', 'https://example.com/a', '/signals/1', '/research/2']);
const catalog = new Map([['/tooling/acme', { href: '/tooling/acme', label: 'Acme', domain: 'acme.ai' }]]);
const base = (over) => ({ section: 'tools', after: 0, title: 'The entrants', caption: 'Four new tools.', ...over });

test('an entities figure keeps catalog entities and resolves the favicon domain', () => {
  const { figures, dropped } = validateFigures([base({ kind: 'entities', entities: [
    { label: 'Acme', href: '/tooling/acme', note: 'x', bullets: ['a', 'b', 'c', 'd'] },
    { label: 'Ext', href: 'https://example.com/a', note: '', bullets: [] },
  ] })], allowed, catalog);
  assert.equal(dropped.length, 0);
  assert.equal(figures[0].entities[0].domain, 'acme.ai');
  assert.equal(figures[0].entities[0].bullets.length, 3);
  assert.equal(figures[0].entities[1].domain, 'example.com');
  assert.equal(figures[0].columns, 2);
});

test('an entity with an href outside the allow-list drops the whole figure', () => {
  const { figures, dropped } = validateFigures([base({ kind: 'entities', entities: [
    { label: 'Acme', href: '/tooling/acme' }, { label: 'Rogue', href: 'https://rogue.example/x' },
  ] })], allowed, catalog);
  assert.equal(figures.length, 0);
  assert.match(dropped[0], /outside the issue's evidence/);
});

test('compare requires an allow-listed href on every bar; map and relation allow href-less entities', () => {
  const bad = validateFigures([base({ kind: 'compare', unit: '%', bars: [{ label: 'a', value: 1, href: '/signals/1' }, { label: 'b', value: 2, href: '' }] })], allowed);
  assert.equal(bad.figures.length, 0);
  const ok = validateFigures([
    base({ kind: 'map', x: { label: 'Open', low: 'closed', high: 'open' }, y: { label: 'Cost', low: 'cheap', high: 'dear' }, points: [{ label: 'M1', href: '', x: 0.2, y: 0.9 }, { label: 'M2', href: '/signals/1', x: 0.8, y: 0.1 }] }),
    base({ kind: 'relation', nodes: [{ id: 'r', label: 'Regulator', href: '', group: 'Rules' }, { id: 'b', label: 'Bank', href: '', group: 'Firms' }, { id: 'm', label: 'Model', href: '/signals/1', group: 'Models' }], edges: [{ from: 'r', to: 'b', label: 'supervises' }, { from: 'b', to: 'm', label: 'deploys' }, { from: 'x', to: 'b', label: 'ghost' }] }),
  ], allowed);
  assert.equal(ok.figures.length, 2);
  assert.equal(ok.figures[1].edges.length, 2, 'an edge to an unknown node is dropped');
});

test('coordinates clamp to 0..1 and a map without axis labels drops', () => {
  const r = validateFigures([
    base({ kind: 'map', x: { label: 'X', low: '', high: '' }, y: { label: 'Y', low: '', high: '' }, points: [{ label: 'a', href: '', x: 4, y: -1 }, { label: 'b', href: '', x: 0.5, y: 0.5 }] }),
    base({ kind: 'map', x: { label: '', low: '', high: '' }, y: { label: 'Y', low: '', high: '' }, points: [{ label: 'a', href: '', x: 0, y: 0 }, { label: 'b', href: '', x: 1, y: 1 }] }),
  ], allowed);
  assert.equal(r.figures.length, 1);
  assert.deepEqual([r.figures[0].points[0].x, r.figures[0].points[0].y], [1, 0]);
});

test('timeline sorts by date and needs three real dates; steps need three', () => {
  const r = validateFigures([
    base({ kind: 'timeline', events: [{ date: '2026-09-24', label: 'later', href: '' }, { date: '2026-09-20', label: 'first', href: '/signals/1' }, { date: 'soon', label: 'bad', href: '' }, { date: '2026-09-22', label: 'mid', href: '' }] }),
    base({ kind: 'steps', steps: [{ label: 'one', note: '' }, { label: 'two', note: 'n' }] }),
  ], allowed);
  assert.equal(r.figures.length, 1);
  assert.deepEqual(r.figures[0].events.map((e) => e.label), ['first', 'mid', 'later']);
  assert.match(r.dropped[0], /fewer than 3 steps/);
});

test('caps: two per section, six per issue, banned words in a caption', () => {
  const many = Array.from({ length: 9 }, (_, i) => base({ kind: 'steps', section: i < 4 ? 'lead' : 'tools', steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }));
  const r = validateFigures(many, allowed);
  assert.equal(r.figures.filter((f) => f.section === 'lead').length, 2);
  assert.equal(r.figures.length, 4);
  const b = validateFigures([base({ kind: 'steps', caption: 'this claim moved', steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] })], allowed, new Map(), /this claim/i);
  assert.equal(b.figures.length, 0);
  assert.ok(MAX_FIGURES_PER_ISSUE >= 4);
});

test('splitBlocks keeps marked output whole and interleave places a figure after its block', () => {
  const html = '<p>one</p>\n<p>two <a href="/x">x</a></p>\n<ul><li>a</li></ul>\n<p>four</p>';
  const blocks = splitBlocks(html);
  assert.equal(blocks.length, 4);
  const fig = validateFigures([base({ kind: 'steps', section: 'lead', after: 1, steps: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] })], allowed).figures[0];
  const pieces = interleave(html, [fig]);
  assert.equal(pieces.length, 5);
  assert.ok('figure' in pieces[2]);
  const tail = interleave(html, [{ ...fig, after: 99 }]);
  assert.ok('figure' in tail[4]);
  assert.equal(interleave(null, [fig]).length, 1);
});

test('every layout stays inside its own box', () => {
  const specs = [
    base({ kind: 'timeline', section: 'lead', events: [{ date: '2026-09-20', label: 'A long event label that wraps around', href: '' }, { date: '2026-09-22', label: 'B', href: '' }, { date: '2026-09-24', label: 'C', href: '' }, { date: '2026-09-25', label: 'D', href: '' }] }),
    base({ kind: 'compare', section: 'moved', unit: 'pp', bars: [{ label: 'a', value: 40, href: '/signals/1' }, { label: 'b', value: -12.5, href: '/research/2' }, { label: 'c', value: 3, href: '/signals/1' }] }),
    base({ kind: 'steps', section: 'research', steps: [{ label: 'Ingest', note: 'feeds and search' }, { label: 'Hydrate', note: '' }, { label: 'Enrich', note: 'a cheap model' }, { label: 'Publish', note: '' }] }),
    base({ kind: 'map', section: 'regulation', x: { label: 'Openness', low: 'closed', high: 'open' }, y: { label: 'Cost', low: 'low', high: 'high' }, points: [{ label: 'A', href: '', x: 0.1, y: 0.1 }, { label: 'B', href: '', x: 0.12, y: 0.12 }, { label: 'C', href: '', x: 0.95, y: 0.9 }] }),
    base({ kind: 'relation', nodes: [{ id: 'a', label: 'A', href: '', group: 'G1' }, { id: 'b', label: 'B', href: '', group: 'G2' }, { id: 'c', label: 'C', href: '', group: 'G2' }, { id: 'd', label: 'D', href: '', group: '' }], edges: [{ from: 'a', to: 'b', label: 'x' }, { from: 'b', to: 'c', label: '' }, { from: 'a', to: 'd', label: 'y' }] }),
  ];
  const { figures } = validateFigures(specs, allowed);
  assert.equal(figures.length, 5);
  for (const f of figures) {
    const l = layoutFigure(f);
    assert.ok(l && l.height > 40 && l.width === FIG_W, `${f.kind} has a layout`);
    for (const p of l.prims) {
      const xs = p.t === 'rect' ? [p.x, p.x + p.w] : p.t === 'circle' ? [p.cx - p.r, p.cx + p.r] : p.t === 'line' ? [p.x1, p.x2] : p.t === 'text' ? [p.x] : [];
      const ys = p.t === 'rect' ? [p.y, p.y + p.h] : p.t === 'circle' ? [p.cy - p.r, p.cy + p.r] : p.t === 'line' ? [p.y1, p.y2] : p.t === 'text' ? [p.y] : [];
      for (const x of xs) assert.ok(x >= -1 && x <= FIG_W + 1, `${f.kind} ${p.t} x ${x}`);
      for (const y of ys) assert.ok(y >= -1 && y <= l.height + 1, `${f.kind} ${p.t} y ${y} of ${l.height}`);
    }
  }
  assert.equal(layoutFigure(validateFigures([base({ kind: 'entities', entities: [{ label: 'a' }, { label: 'b' }] })], allowed).figures[0]), null);
});

test('wrapText and domainOf', () => {
  assert.deepEqual(wrapText('one two three four five six', 9, 2), ['one two', 'three…']);
  assert.equal(domainOf('https://www.Example.com/x?y'), 'example.com');
  assert.equal(domainOf('/tooling/acme'), null);
});

test('appendix B lists cited links once, in reading order, only when the gate allows them', () => {
  const narrative = {
    summary: ['<p>Cost fell (<a href="https://www.anthropic.com/claude-opus-5-5">Opus 5.5</a>).</p>'],
    lead: { html: '<p><a href="https://arxiv.org/abs/2609.30058">a new paper</a> and <a href="https://evil.example/x">junk</a> and <a href="/signals/abc">the signal</a> and again <a href="https://www.anthropic.com/claude-opus-5-5">Opus</a>.</p>' },
    departments: [{ key: 'tools', html: '<p><a href="https://github.com/truefoundry">https://github.com/truefoundry</a> &amp; more</p>' }],
    figures: [{ spec: { entities: [{ href: 'https://nope.example' }] } }],
  };
  const allowed = new Set(['https://www.anthropic.com/claude-opus-5-5', 'https://arxiv.org/abs/2609.30058', '/signals/abc', 'https://github.com/truefoundry']);
  const out = collectCitedSources(narrative, allowed);
  assert.deepEqual(out.map((o) => o.href), ['https://www.anthropic.com/claude-opus-5-5', 'https://arxiv.org/abs/2609.30058', '/signals/abc', 'https://github.com/truefoundry']);
  assert.equal(out[0].label, 'Opus 5.5');
  assert.equal(out[2].host, 'The AI Atlas');
  assert.equal(out[3].label, 'github.com/truefoundry', 'a bare-URL label falls back to the readable URL');
  assert.equal(hostOf('https://www.cnbc.com/2026/09/22/x.html'), 'cnbc.com');
});

test('footnote numbers and dates are not labels: a later mention or a readable fallback wins', () => {
  const narrative = { a: '<a href="/claim/1.3">3</a> then <a href="/claim/1.3">inference cost per unit</a>', b: '<a href="/bridge/B5">5</a> <a href="https://www.sec.gov/Archives/edgar/data/1/2/x.htm">2026-09-24</a>' };
  const out = collectCitedSources(narrative, new Set(['/claim/1.3', '/bridge/B5', 'https://www.sec.gov/Archives/edgar/data/1/2/x.htm']));
  assert.deepEqual(out.map((o) => o.label), ['inference cost per unit', 'Bridge-claim B5', 'SEC filing']);
  assert.equal(fallbackLabel('/tooling/kong-ai-gateway'), 'Tool: kong ai gateway');
});

test('long URLs get zero-width break points and lose their scheme', () => {
  const u = 'https://www.frbsf.org/research-and-insights/publications/system-research';
  assert.equal(displayUrl(u), 'frbsf.org/research-and-insights/publications/system-research');
  const b = breakableUrl(displayUrl(u));
  assert.ok(b.includes('/\u200B'));
  assert.equal(b.replace(/\u200B/g, ''), displayUrl(u), 'only zero-width spaces are added');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Pure tests for the Daily Edition's newspaper PDF view model
// (lib/edition/paper.ts): masthead + online link, absolute hrefs, the
// column split into two gated halves with <code> unwrapped, desks balanced
// into columns, blind-spot cleaning, the "What builders are reading" groups +
// vendor releases, the research section's quiet-importance marks/kicker, the
// no-em-dash backstop.
// READ-ONLY, no DB, no model call, no PDF render.
// Run: node scripts/test-edition-paper.mjs

import assert from 'node:assert/strict';
import { buildEditionPaper, editionPaperFilename, splitColumnHtml } from '../lib/edition/paper.ts';
import { clusterStories } from '../lib/edition/cluster.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const ORIGIN = 'https://atlas.example.com';

const it = (id, headline, extra = {}) => ({
  id, source: 'scan', headline, url: `https://outlet-${id}.com/story`, domain: `outlet-${id}.com`, tier: 2,
  contentKind: 'news', relevance: 0.7, publishedDate: '2026-09-25', summary: `Summary for ${id}.`,
  entities: [], tags: [], href: null, ...extra,
});

function fixture({ frontCount = 3, code = true } = {}) {
  const clusters = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com', url: 'https://wire.com/nvidia', tier: 1 }),
    it('c', 'EU delays AI Act enforcement for foundation models', { href: '/signals/sig-1' }),
    it('d', 'OpenAI cuts API prices for GPT models by half'),
  ]);
  const front = clusters.slice(0, frontCount).map((c, i) => ({
    clusterId: c.id, headline: `${c.lead.headline} — front`, why: 'Why it matters — plainly.', numbers: i === 0 ? '$1 billion' : null,
    goDeeperHref: c.lead.href ?? c.lead.url, goDeeperLabel: c.lead.href ? 'Read the signal' : 'Read the source',
    coverage: i === 0 ? '2 outlets, 1 tier 1' : '1 outlet',
  }));
  const thingsHappen = [
    { headline: 'Anthropic releases a new model with lower inference cost', url: 'https://t1.com/a', domain: 't1.com', tier: 2, href: '/signals/sig-9', desk: 'labs' },
    { headline: 'California executive order directs a study of AI kill switches', url: 'https://t2.com/b', domain: 't2.com', tier: null, href: null, desk: 'policy' },
    { headline: 'Korea HBM exports surge as packaging capacity grows', url: 'https://t3.com/c', domain: 't3.com', tier: 3, href: null, desk: 'chips' },
    { headline: 'A stored row with no desk stamp about GPU supply', url: 'https://t4.com/d', domain: 't4.com', tier: 2, href: null },
    { headline: 'A stored row with a bogus desk about model evals', url: 'https://t5.com/e', domain: 't5.com', tier: 2, href: null, desk: 'nonsense' },
  ];
  const codeBit = code ? ' and a <code>--flag</code> token' : '';
  const columnHtml =
    `<p>First beat with <a href="/claim/1.2">inference is getting cheaper</a>${codeBit}.</p>` +
    `<h3>Second beat</h3><p>Middle paragraph about <a href="/signals/sig-1">the EU delay</a>.</p>` +
    `<p>Closing line with <a href="https://evil.example.com/x">an ungated link</a>.</p>`;
  const pack = {
    day: '2026-09-25', windowFrom: '2026-09-24T16:45:00.000Z', windowTo: '2026-09-25T16:45:00.000Z', issueNumber: 4,
    numbers: { itemsRead: 65, outlets: 62, signalsPublished: 19, papersKept: 11, newTools: 0, clusters: 31 },
    clusters, thingsHappen,
    industry: [{ headline: 'Ally launches a rewards program', url: 'https://ally.example.com/loyally', domain: 'ally.example.com', tier: 2, href: null }],
    papers: [{
      id: 'p1', title: 'A paper — on agents', href: '/research/p1', whoCares: 'x'.repeat(300), headlineClaim: null,
      finding: 'Agents cut latency by half — the paper argues.',
      weight: { marks: 2, confirmed: true, reach: 1, rigorBand: null, contradicts: true, kicker: 'TRACKED · CONTRADICTS' },
    }],
    tools: [],
    builders: {
      judged: true,
      reads: [
        {
          title: 'Cursor ships a big autocomplete upgrade', url: 'https://cursor.com/blog/autocomplete',
          hnUrl: 'https://news.ycombinator.com/item?id=901', points: 320, comments: 210, tag: 'tooling',
          line: 'Why builders should care about this shift.', showHn: false, repo: false, debate: true, catalogHref: '/tooling/cursor',
        },
        {
          title: 'A team postmortems a failed agent rollout', url: null,
          hnUrl: 'https://news.ycombinator.com/item?id=902', points: 88, comments: 12, tag: 'field',
          line: null, showHn: false, repo: false, debate: false, catalogHref: null,
        },
      ],
      releases: [
        { productName: 'Cursor', productHref: '/tooling/cursor', title: 'Cursor 2.0 launches with background agents', url: 'https://cursor.com/changelog/2-0', kind: 'launch', date: '2026-09-24' },
      ],
    },
    blindSpots: [
      { headline: 'Fortune', url: 'https://fortune.com/' },
      { headline: 'Cheniere Energy (LNG) Q4 2025 Earnings Call Transcript', url: 'https://fool.com/t' },
      { headline: 'OpenAI releases a new frontier model with 2x cheaper inference', url: 'https://outlet.com/openai-model' },
    ],
    sources: [{ domain: 'wire.com', tier: 1, count: 5 }, { domain: 'outlet-a.com', tier: 2, count: 3 }],
    claimsTouched: [{ code: '1.2', statement: 'Inference cost falls', href: '/claim/1.2', signalHrefs: ['/signals/sig-1'] }],
    hn: [{ title: 'Show HN: a thing', url: 'https://thing.dev', hnUrl: 'https://news.ycombinator.com/item?id=1', points: 100, comments: 20 }],
    markets: { asOf: '2026-09-25T16:45:00.000Z', rows: [{ symbol: 'NVDA', label: 'Utilities', price: 39.333, changePct: 0.2, spark: [1, 2] }, { symbol: 'META', label: 'Meta', price: 750, changePct: -3.6, spark: [2, 1] }] },
    generatedAt: '2026-09-25T16:45:06.000Z',
  };
  return {
    id: 'ed-1', day: '2026-09-25', pack,
    narrative: { front, column: { title: 'Scams, Quantum Clocks — and the Data Gold Rush', html: columnHtml }, citedTags: [], dropped: [], model: 'x' },
    is_published: true, generated_at: pack.generatedAt,
  };
}

const m = buildEditionPaper(fixture(), ORIGIN);

check('masthead carries the date, issue number and the online link', () => {
  assert.equal(m.masthead.onlineUrl, `${ORIGIN}/blotter/2026-09-25`);
  assert.equal(m.masthead.issue, 'No. 4');
  assert.equal(m.masthead.dateLabel, 'Sep 25, 2026');
});

check('numbers strip labels the honest counts and markets are formatted', () => {
  assert.deepEqual(m.numbers.map((n) => n.label), ['Items read', 'Outlets', 'Signals', 'Papers', 'AI stories']);
  assert.equal(m.markets[0].price, '39.33');
  assert.equal(m.markets[1].price, '750');
  assert.equal(m.markets[1].change, '-3.6%');
  assert.equal(m.markets[1].dir, 'down');
});

check('lead is front[0], the rest are secondary, hrefs absolute, coverage hidden for one plain outlet', () => {
  assert.equal(m.secondary.length, 2);
  assert.ok(m.lead.href.startsWith('http'));
  assert.equal(m.lead.coverage, '2 outlets, 1 tier 1');
  assert.equal(m.secondary[0].coverage, '');
  for (const f of [m.lead, ...m.secondary]) assert.ok(/^https?:\/\//.test(f.href), f.href);
  const signalItem = [m.lead, ...m.secondary].find((f) => f.label === 'Read the signal');
  assert.ok(signalItem && signalItem.href === `${ORIGIN}/signals/sig-1`);
});

check('column splits into two non-empty halves, gated, with <code> unwrapped', () => {
  assert.ok(m.column);
  const [l, r] = m.column.halves;
  assert.ok(l.length > 0 && r.length > 0);
  assert.ok(!/<code/.test(l + r), 'code unwrapped');
  assert.ok((l + r).includes('--flag'), 'code text kept');
  assert.ok((l + r).includes('href="/claim/1.2"'), 'claim link survives');
  assert.ok(!(l + r).includes('evil.example.com'), 'ungated link stripped');
  assert.ok(!(l + r).includes('—'));
  assert.equal(m.column.title, 'Scams, Quantum Clocks, and the Data Gold Rush');
});

check('splitColumnHtml balances by text length and never empties the right half of a multi-block column', () => {
  const [a, b] = splitColumnHtml('<p>aaaa aaaa aaaa</p><p>bb</p><p>cc</p>');
  assert.ok(a.includes('aaaa') && b.includes('cc'));
  const [one, none] = splitColumnHtml('<p>only</p>');
  assert.equal(one, '<p>only</p>');
  assert.equal(none, '');
});

check('desks: stamps trusted only when valid, headline fallback otherwise, columns balanced to min(3, desks)', () => {
  const blocks = m.deskColumns.flat();
  assert.ok(m.deskColumns.length <= 3 && m.deskColumns.length >= 1);
  const labels = blocks.map((b) => b.label);
  assert.ok(labels.includes('Labs & models') && labels.includes('Policy & regulation') && labels.includes('Chips & infrastructure'));
  const chips = blocks.find((b) => b.label === 'Chips & infrastructure');
  assert.ok(chips.items.some((i) => i.headline.includes('GPU supply')), 'unstamped row grouped from headline');
  const labs = blocks.find((b) => b.label === 'Labs & models');
  assert.ok(labs.items.some((i) => i.headline.includes('model evals')), 'bogus stamp recomputed');
  assert.equal(blocks.reduce((n, b) => n + b.items.length, 0), 5);
  assert.equal(m.thingsCount, 5);
  for (const b of blocks) for (const i of b.items) assert.ok(/^https?:\/\//.test(i.href));
  assert.ok(labs.items.find((i) => i.inAtlas));
});

check('industry, research (clipped dek from finding, marks/kicker/contradicts), hn and sources project through', () => {
  assert.equal(m.industry.length, 1);
  assert.equal(m.research.length, 1);
  assert.equal(m.research[0].href, `${ORIGIN}/research/p1`);
  assert.ok(m.research[0].dek.length <= 220);
  assert.equal(m.research[0].dek, 'Agents cut latency by half, the paper argues.');
  assert.equal(m.research[0].marks, 2);
  assert.equal(m.research[0].kicker, 'TRACKED · CONTRADICTS');
  assert.equal(m.research[0].contradicts, true);
  assert.equal(m.researchHead, 'Research · 11 analyzed, top 1');
  assert.equal(m.hn[0].meta, '100 points · 20 comments');
  assert.equal(m.sourcesLine, 'wire.com 5 · outlet-a.com 3');
});

check('builders: groups in BUILDER_TAGS order, hrefs absolute (url ?? hnUrl), catalog + debate meta present', () => {
  assert.ok(m.builders);
  assert.deepEqual(m.builders.groups.map((g) => g.label), ['Tooling & models', 'Field notes']);
  const toolingGroup = m.builders.groups.find((g) => g.label === 'Tooling & models');
  const toolingItem = toolingGroup.items[0];
  assert.equal(toolingItem.href, 'https://cursor.com/blog/autocomplete');
  assert.ok(toolingItem.meta.includes('debate'));
  assert.ok(toolingItem.meta.includes('in the catalog'));
  const fieldGroup = m.builders.groups.find((g) => g.label === 'Field notes');
  const fieldItem = fieldGroup.items[0];
  assert.equal(fieldItem.href, 'https://news.ycombinator.com/item?id=902'); // no url, falls back to hnUrl
});

check('builders: release productHref is absolute, meta carries kind and date', () => {
  const release = m.builders.releases[0];
  assert.equal(release.productHref, `${ORIGIN}/tooling/cursor`);
  assert.equal(release.href, 'https://cursor.com/changelog/2-0');
  assert.ok(release.meta.includes('launch'));
});

check('builders is null when the pack omits it (an older stored edition)', () => {
  const ed = fixture();
  delete ed.pack.builders;
  assert.equal(buildEditionPaper(ed, ORIGIN).builders, null);
});

check('blind spots are cleaned at render: junk titles drop, the AI headline stays', () => {
  assert.deepEqual(m.blindSpots.map((b) => b.headline), ['OpenAI releases a new frontier model with 2x cheaper inference']);
});

check('no em dash anywhere in the model', () => {
  assert.ok(!JSON.stringify(m).includes('—'));
});

check('an empty column yields null; filename is day-keyed', () => {
  const ed = fixture();
  ed.narrative.column.html = '';
  assert.equal(buildEditionPaper(ed, ORIGIN).column, null);
  assert.equal(editionPaperFilename('2026-09-25'), 'atlas-edition-2026-09-25.pdf');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

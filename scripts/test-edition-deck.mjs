// Pure tests for the Daily Edition's 16:9 deck builder (lib/edition/deck.ts):
// slide order, front-item hrefs, things-happen chunking, the sources slide,
// the column's citation-gated links slide, and the no-em-dash backstop.
// READ-ONLY, no DB, no model call.
// Run: node scripts/test-edition-deck.mjs

import assert from 'node:assert/strict';
import { buildEditionDeck } from '../lib/edition/deck.ts';
import { clusterStories } from '../lib/edition/cluster.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const it = (id, headline, extra = {}) => ({
  id, source: 'scan', headline, url: `https://outlet-${id}.com/story`, domain: `outlet-${id}.com`, tier: 2,
  contentKind: 'news', relevance: 0.7, publishedDate: '2026-09-22', summary: `Summary for ${id}.`,
  entities: [], tags: [], href: null, ...extra,
});

const ORIGIN = 'https://atlas.example.com';

function fixtureEdition() {
  const clusters = clusterStories([
    it('a', 'Nvidia reports record data center revenue in Q3'),
    it('b', 'Nvidia data center revenue hits record in Q3', { domain: 'wire.com', url: 'https://wire.com/nvidia', tier: 1 }),
    it('c', 'EU delays AI Act enforcement for foundation models', { href: '/signals/sig-1' }),
  ]);

  const thingsHappen = Array.from({ length: 15 }, (_, i) => ({
    headline: `A minor story number ${i + 1}`,
    url: `https://minor-${i + 1}.com/x`,
    domain: `minor-${i + 1}.com`,
    tier: (i % 4) + 1,
    href: i === 0 ? '/signals/minor-1' : null,
  }));

  const pack = {
    day: '2026-09-22',
    windowFrom: '2026-09-22T00:00:00.000Z',
    windowTo: '2026-09-23T00:00:00.000Z',
    issueNumber: 4,
    numbers: { itemsRead: 20, outlets: 5, signalsPublished: 2, papersKept: 1, newTools: 0, clusters: clusters.length },
    clusters,
    thingsHappen,
    companies: [],
    papers: [{ id: 'p1', title: 'A paper worth reading', href: '/research/p1', whoCares: 'because it changes the cost curve', headlineClaim: 'a claim' }],
    tools: [{ slug: 'tool-1', name: 'Tool One', vendor: 'Acme', oneLiner: 'does agentic things', href: '/tooling/tool-1' }],
    blindSpots: [{ headline: 'Something the desk did not catch', url: 'https://missed.com/story' }],
    sources: [
      { domain: 'outlet-a.com', tier: 2, count: 4 },
      { domain: 'wire.com', tier: 1, count: 2 },
    ],
    claimsTouched: [{ code: '2.3', statement: 'A claim statement.', href: '/claim/2.3', signalHrefs: ['/signals/sig-1'] }],
    hn: [
      { title: 'Why agentic harnesses keep failing', url: 'https://blog.example.com/harnesses', hnUrl: 'https://news.ycombinator.com/item?id=1', points: 400, comments: 120 },
      { title: 'Show HN: a new inference server', url: null, hnUrl: 'https://news.ycombinator.com/item?id=2', points: 88, comments: 30 },
    ],
    markets: {
      asOf: '2026-09-22T20:00:00.000Z',
      rows: [
        { symbol: 'NVDA', label: 'Nvidia', price: 228.87, changePct: 0.655, spark: [1, 2, 3] },
        { symbol: 'MSFT', label: 'Microsoft', price: 512.3, changePct: -1.2, spark: [4, 5, 6] },
      ],
    },
    generatedAt: '2026-09-22T20:45:00.000Z',
  };

  const narrative = {
    front: [
      {
        clusterId: clusters[0].id,
        headline: 'Nvidia posts record data center revenue',
        why: 'The data center segment keeps outrunning every other line of business.',
        numbers: 'Data center revenue up 62% year over year.',
        goDeeperHref: clusters[0].lead.url,
        goDeeperLabel: 'Read the source',
        coverage: '2 outlets, 1 tier 1',
      },
      {
        clusterId: clusters[1].id,
        headline: 'The EU delays AI Act enforcement',
        why: 'Regulators are giving foundation-model makers more runway to comply.',
        numbers: null,
        goDeeperHref: '/signals/sig-1',
        goDeeperLabel: 'Read the signal',
        coverage: '1 outlet',
      },
    ],
    column: {
      title: 'What the numbers actually say',
      // The dropped (ungated) link is placed LAST: sanitize-html's
      // transformTags mis-closes a kept <a> that follows a dropped one
      // anywhere earlier in the document (a pre-existing lib/citations.ts
      // quirk, out of scope here), so the fixture orders links kept-then-
      // dropped to isolate the gating behavior under test.
      html:
        '<p>Today the market moved on one thing. <a href="https://outlet-a.com/story">One outlet</a> covered it well.</p>' +
        '<p>The claims ledger has more at <a href="/claim/2.3">claim 2.3</a>.</p>' +
        '<p>Meanwhile something odd made the rounds that nobody on this desk can vouch for: <a href="https://untracked.example.com/story">an untracked claim</a>.</p>',
    },
    citedTags: ['2.3'],
    dropped: ['https://untracked.example.com/story'],
    model: 'z-ai/glm-5.3-flash',
  };

  return {
    id: 'edition-1', day: pack.day, pack, narrative, is_published: true, generated_at: pack.generatedAt,
  };
}

console.log('edition deck:');

const edition = fixtureEdition();
const deck = buildEditionDeck(edition, ORIGIN);

check('slide order starts with a title slide', () => {
  assert.equal(deck.slides[0].kind, 'title');
  assert.equal(deck.slides[0].title, edition.narrative.front[0].headline);
});

check('one bullets slide per front item, with an absolutized Go deeper href', () => {
  const frontSlides = deck.slides.filter((s) => s.kind === 'bullets' && s.kicker.startsWith('FRONT ·'));
  assert.equal(frontSlides.length, edition.narrative.front.length);
  frontSlides.forEach((s, i) => {
    const item = edition.narrative.front[i];
    assert.equal(s.title, item.headline);
    const goDeeper = s.bullets.find((b) => b.lead === 'Go deeper');
    assert.ok(goDeeper, 'missing Go deeper bullet');
    const expected = item.goDeeperHref.startsWith('/') ? ORIGIN + item.goDeeperHref : item.goDeeperHref;
    assert.equal(goDeeper.href, expected);
  });
});

check('front item numbers bullet only appears when the item has numbers', () => {
  const frontSlides = deck.slides.filter((s) => s.kind === 'bullets' && s.kicker.startsWith('FRONT ·'));
  assert.ok(frontSlides[0].bullets.some((b) => b.lead === 'By the numbers'));
  assert.ok(!frontSlides[1].bullets.some((b) => b.lead === 'By the numbers'));
});

check('things-happen slides chunk at 7 items each', () => {
  const thingsSlides = deck.slides.filter((s) => s.kind === 'bullets' && s.kicker.startsWith('THINGS HAPPEN ·'));
  assert.equal(thingsSlides.length, 3);
  assert.equal(thingsSlides[0].bullets.length, 7);
  assert.equal(thingsSlides[1].bullets.length, 7);
  assert.equal(thingsSlides[2].bullets.length, 1);
});

check('a things-happen bullet carries a domain/tier meta line and an absolutized href', () => {
  const thingsSlides = deck.slides.filter((s) => s.kind === 'bullets' && s.kicker.startsWith('THINGS HAPPEN ·'));
  const first = thingsSlides[0].bullets[0];
  assert.equal(first.meta, 'minor-1.com · T1');
  assert.equal(first.href, ORIGIN + '/signals/minor-1');
  const second = thingsSlides[0].bullets[1];
  assert.equal(second.href, edition.pack.thingsHappen[1].url);
});

check('a sources slide is present with the top domains and an outlets takeaway', () => {
  const sourcesSlide = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Sources');
  assert.ok(sourcesSlide, 'missing sources slide');
  assert.equal(sourcesSlide.bullets.length, edition.pack.sources.length);
  assert.equal(sourcesSlide.bullets[0].lead, 'outlet-a.com');
  assert.equal(sourcesSlide.bullets[0].text, '4 items, tier 2');
  assert.equal(sourcesSlide.takeaway, '5 outlets read today');
});

check('the links-from-the-column slide carries only citation-gated hrefs', () => {
  const linksSlide = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Links from the column');
  assert.ok(linksSlide, 'missing links slide');
  const hrefs = linksSlide.bullets.map((b) => b.href);
  assert.ok(hrefs.includes('https://outlet-a.com/story'), 'allowed link missing');
  assert.ok(hrefs.includes(ORIGIN + '/claim/2.3'), 'allowed internal link missing or not absolutized');
  assert.ok(!hrefs.includes('https://untracked.example.com/story'), 'ungated link leaked through');
});

check('a divider slide introduces the column, titled with the column title', () => {
  const columnDivider = deck.slides.find((s) => s.kind === 'divider' && s.kicker === 'The column');
  assert.ok(columnDivider);
  assert.equal(columnDivider.title, edition.narrative.column.title);
});

check('the deck closes with a divider slide, last in the list', () => {
  const last = deck.slides[deck.slides.length - 1];
  assert.equal(last.kind, 'divider');
  assert.equal(last.kicker, 'Close');
});

check('the numbers strip is a stat-grid slide sized to the pack', () => {
  const statGrid = deck.slides.find((s) => s.kind === 'stat-grid');
  assert.ok(statGrid);
  // newTools is 0 in the fixture, so it is omitted: 5 stats, not 6.
  assert.equal(statGrid.stats.length, 5);
});

check('a markets slide renders one bullet per row with a signed change', () => {
  const marketsSlide = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Markets at press time');
  assert.ok(marketsSlide);
  assert.equal(marketsSlide.bullets.length, 2);
  assert.equal(marketsSlide.bullets[0].lead, 'Nvidia 229');
  assert.equal(marketsSlide.bullets[0].text, '+0.7%');
  assert.equal(marketsSlide.bullets[1].text, '-1.2%');
});

check('a "what builders are reading" slide renders HN points and comments', () => {
  const hnSlide = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'What builders are reading');
  assert.ok(hnSlide);
  assert.equal(hnSlide.bullets[0].text, '400 points · 120 comments');
  assert.equal(hnSlide.bullets[1].href, 'https://news.ycombinator.com/item?id=2');
});

check('research, tools and blind spots slides render with absolutized in-app hrefs', () => {
  const research = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Research');
  const tools = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Tools');
  const blind = deck.slides.find((s) => s.kind === 'bullets' && s.title === 'Blind spots');
  assert.equal(research.bullets[0].href, ORIGIN + '/research/p1');
  assert.equal(tools.bullets[0].href, ORIGIN + '/tooling/tool-1');
  assert.equal(blind.bullets[0].href, 'https://missed.com/story');
});

check('no em dash appears anywhere in the built deck', () => {
  assert.ok(!JSON.stringify(deck).includes('—'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

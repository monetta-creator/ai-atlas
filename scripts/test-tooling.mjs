// Tests for the AI Tooling Monitor's deterministic core: dedupe
// normalization (must mirror the tooling_products generated/writer-set
// columns), feature-tag normalization, feed-link discovery, source mappers,
// the dossier merge, hint parsing, and the discovery/checkpoint plan.
// READ-ONLY: never writes a row. Node type stripping loads the .ts module.
// Run: node scripts/test-tooling.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  productNameKey, productUrlKey, slugify, weekKey,
  normalizeFeatureTag, normalizeFeatureTags, discoverFeedLinks,
  mapHnHits, mapGithubRepos, mapProductHuntPosts, mapTavilyHits,
  mergeToolingDossier, eventExists, parseMaturityHint, parseEventKindHint,
  matchExisting, toolingPlan, sweepUnit, nextUnswept, clampFit, isNewsHost,
  resolveToolingTokens, isProductUrl,
} from '../lib/tooling/core.ts';

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

console.log('tooling core:');

check('productNameKey mirrors the generated-column expression', () => {
  assert.equal(productNameKey('Cursor AI, Inc.'), 'cursoraiinc');
  assert.equal(productNameKey('  Acme  Copilot  '), 'acmecopilot');
  assert.equal(productNameKey('C3.ai'), 'c3ai');
  assert.equal(productNameKey('!!!'), '');
});

check('productUrlKey strips www/query/trailing slash and lowercases the host', () => {
  assert.equal(productUrlKey('https://WWW.Example.com/Products/Foo/?ref=hn&utm_source=x'), 'example.com/Products/Foo');
  assert.equal(productUrlKey('https://example.com/'), 'example.com');
  assert.equal(productUrlKey('https://example.com'), 'example.com');
  assert.equal(productUrlKey('http://sub.example.com/a/b//'), 'sub.example.com/a/b');
  assert.equal(productUrlKey(null), null);
  assert.equal(productUrlKey(''), null);
  assert.equal(productUrlKey('not a url'), null);
});

check('slugify: lowercase, hyphenated, no leading/trailing hyphen', () => {
  assert.equal(slugify('Cursor AI'), 'cursor-ai');
  assert.equal(slugify('  C3.ai!!  '), 'c3-ai');
  assert.equal(slugify('---Weird---'), 'weird');
  assert.equal(slugify(''), '');
});

check('weekKey: the Monday of the UTC week, for Sunday/Monday/Wednesday', () => {
  assert.equal(weekKey(new Date('2026-09-13T10:00:00Z')), '2026-09-07'); // Sunday
  assert.equal(weekKey(new Date('2026-09-07T00:00:00Z')), '2026-09-07'); // Monday
  assert.equal(weekKey(new Date('2026-09-09T23:59:00Z')), '2026-09-07'); // Wednesday
  assert.equal(weekKey(new Date('2026-09-14T00:00:00Z')), '2026-09-14'); // next Monday
});

check('normalizeFeatureTag: collapses whitespace/punctuation, strips trailing period, length gate', () => {
  assert.equal(normalizeFeatureTag('  SOC 2   Compliance.  '), 'soc 2 compliance');
  assert.equal(normalizeFeatureTag('Real-time collaboration'), 'real-time collaboration');
  assert.equal(normalizeFeatureTag('ok'), null, 'too short');
  assert.equal(normalizeFeatureTag('x'.repeat(61)), null, 'too long');
  assert.equal(normalizeFeatureTag(''), null);
  assert.equal(normalizeFeatureTag('SSO...'), 'sso');
});

check('normalizeFeatureTags: dedupes case-insensitively, preserves order, caps', () => {
  assert.deepEqual(
    normalizeFeatureTags(['SSO', 'sso.', 'RBAC', 'sso', '  RBAC  ']),
    ['sso', 'rbac']
  );
  const many = Array.from({ length: 30 }, (_, i) => `feature ${i}`);
  assert.equal(normalizeFeatureTags(many).length, 24);
  assert.equal(normalizeFeatureTags(many, 3).length, 3);
});

check('discoverFeedLinks: relative + absolute + attribute-order variants, and a page with none', () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" href="/feed.xml" title="RSS">
    <link href="https://cdn.example.com/atom.xml" type="application/atom+xml" rel="alternate">
    <link rel="stylesheet" href="/style.css">
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
  </head></html>`;
  assert.deepEqual(
    discoverFeedLinks(html, 'https://example.com/blog/'),
    ['https://example.com/feed.xml', 'https://cdn.example.com/atom.xml']
  );
  assert.deepEqual(discoverFeedLinks('<html><head></head></html>', 'https://example.com/'), []);
  assert.deepEqual(discoverFeedLinks('', 'https://example.com/'), []);
});

check('mapHnHits: tolerant of missing fields, text posts map to the item page', () => {
  const hits = mapHnHits([
    { objectID: '111', title: 'Show HN: My tool', url: 'https://mytool.dev', created_at: '2026-09-10T12:00:00Z' },
    { objectID: '222', title: 'Show HN: Text post', story_text: 'A <b>text</b> post.', created_at: '2026-09-11T00:00:00Z' },
    { title: 'no objectID' },
    { objectID: '333' }, // no title
  ]);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, 'https://mytool.dev');
  assert.equal(hits[0].source, 'hn');
  assert.equal(hits[0].publishedISO, '2026-09-10');
  assert.equal(hits[1].url, 'https://news.ycombinator.com/item?id=222');
  assert.ok(hits[1].snippet.includes('text post'));
});

check('mapGithubRepos: tolerant of missing fields', () => {
  const items = mapGithubRepos([
    { full_name: 'acme/tool', html_url: 'https://github.com/acme/tool', description: 'A tool.', pushed_at: '2026-09-01T00:00:00Z' },
    { html_url: 'https://github.com/acme/notitle' }, // no name/full_name
    { full_name: 'acme/nourl' }, // no html_url
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'acme/tool');
  assert.equal(items[0].source, 'github');
  assert.equal(items[0].publishedISO, '2026-09-01');
});

check('mapProductHuntPosts: prefers website over the PH post url', () => {
  const posts = mapProductHuntPosts([
    { name: 'Acme', website: 'https://acme.com', url: 'https://producthunt.com/posts/acme', tagline: 'Great tool', createdAt: '2026-09-05T00:00:00Z' },
    { name: 'NoWebsite', url: 'https://producthunt.com/posts/nowebsite', tagline: 'x' },
    { website: 'https://x.com' }, // no name
  ]);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].url, 'https://acme.com');
  assert.equal(posts[0].source, 'producthunt');
  assert.equal(posts[1].url, 'https://producthunt.com/posts/nowebsite');
});

check('mapTavilyHits: parses/normalizes dates, drops junk', () => {
  const hits = mapTavilyHits([
    { title: 'Launch', url: 'https://example.com/a', content: 'snippet', published_date: 'Fri, 28 Aug 2026 10:00:00 GMT' },
    { title: 'No date', url: 'https://example.com/b' },
    { url: 'https://example.com/c' }, // no title
    { title: 'No url' },
  ]);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].publishedISO, '2026-08-28');
  assert.equal(hits[1].publishedISO, null);
});

check('mergeToolingDossier: latest non-empty summary wins, lists union with caps', () => {
  const t = '2026-09-10T12:00:00.000Z';
  const merged = mergeToolingDossier(
    { summary: 'Old read.', features: ['SSO', 'rbac'], customers: [], integrations: [], updated_by: 'homepage' },
    { summary: '', features: ['RBAC', 'Audit logs'], customers: ['Acme'], integrations: ['Slack'], sources: ['https://a.com'], updated_by: 'deepdive' },
    t
  );
  assert.equal(merged.summary, 'Old read.');
  assert.deepEqual(merged.features, ['SSO', 'rbac', 'Audit logs']);
  assert.deepEqual(merged.customers, ['Acme']);
  assert.deepEqual(merged.integrations, ['Slack']);
  assert.deepEqual(merged.sources, ['https://a.com']);
  assert.equal(merged.updated_by, 'deepdive');
  assert.equal(merged.updated_at, t);
  const replaced = mergeToolingDossier(
    merged, { summary: 'New read.', features: [], customers: [], integrations: [], sources: [], updated_by: 'manual' }, t
  );
  assert.equal(replaced.summary, 'New read.');
  const many = Array.from({ length: 30 }, (_, i) => `f${i}`);
  assert.equal(
    mergeToolingDossier(null, { summary: null, features: many, customers: [], integrations: [], sources: [], updated_by: 'homepage' }, t).features.length,
    24
  );
});

check('eventExists: url match (trailing slash), normalized title, empty url', () => {
  const existing = [{ title: 'v2.0 released!', url: 'https://x.com/changelog/2' }, { title: 'Pricing update', url: null }];
  assert.ok(eventExists(existing, { title: 'other', url: 'https://x.com/changelog/2/' }));
  assert.ok(eventExists(existing, { title: 'V2.0 RELEASED', url: 'https://y.com/b' }));
  assert.ok(eventExists(existing, { title: 'PRICING-UPDATE', url: '' }));
  assert.ok(!eventExists(existing, { title: 'v3.0 released', url: 'https://z.com/c' }));
});

check('parseMaturityHint degrades to unknown', () => {
  assert.equal(parseMaturityHint('open-source project'), 'open_source_project');
  assert.equal(parseMaturityHint('a Microsoft product'), 'big_tech');
  assert.equal(parseMaturityHint('publicly traded incumbent'), 'incumbent');
  assert.equal(parseMaturityHint('a scale-up'), 'scaleup');
  assert.equal(parseMaturityHint('Series C, growth stage'), 'startup_growth');
  assert.equal(parseMaturityHint('early-stage startup, seed funded'), 'startup_early');
  assert.equal(parseMaturityHint(''), 'unknown');
});

check('parseEventKindHint degrades to news', () => {
  assert.equal(parseEventKindHint('Funding round'), 'funding');
  assert.equal(parseEventKindHint('New pricing tier'), 'pricing');
  assert.equal(parseEventKindHint('Strategic partnership'), 'partnership');
  assert.equal(parseEventKindHint('Changelog entry'), 'changelog');
  assert.equal(parseEventKindHint('Product launch'), 'launch');
  assert.equal(parseEventKindHint('New feature update'), 'feature');
  assert.equal(parseEventKindHint('press coverage'), 'news');
  assert.equal(parseEventKindHint(''), 'news');
});

check('matchExisting: url_key match, name_key + matching domain, name_key + null domain, no match', () => {
  const existing = [
    { id: 'a', url_key: 'acme.com', name_key: 'acmetool', vendor_domain: 'acme.com' },
    { id: 'b', url_key: null, name_key: 'otherco', vendor_domain: 'other.com' },
    { id: 'c', url_key: null, name_key: 'thirdco', vendor_domain: null },
  ];
  assert.equal(matchExisting(existing, { url_key: 'acme.com', name_key: 'somethingelse', vendor_domain: null }), 'a');
  assert.equal(matchExisting(existing, { url_key: null, name_key: 'otherco', vendor_domain: 'other.com' }), 'b');
  assert.equal(matchExisting(existing, { url_key: null, name_key: 'thirdco', vendor_domain: 'anything.com' }), 'c');
  assert.equal(matchExisting(existing, { url_key: null, name_key: 'otherco', vendor_domain: 'different.com' }), null);
  assert.equal(matchExisting(existing, { url_key: null, name_key: 'nomatch', vendor_domain: null }), null);
});

check('sweepUnit builds checkpoint strings; toolingPlan orders pull enum units before the shared sweep', () => {
  assert.equal(sweepUnit('ph'), 'ph');
  assert.equal(sweepUnit('cat', 'coding-assistants'), 'cat:coding-assistants');
  assert.equal(sweepUnit('enum', 'coding-assistants', 'leaders'), 'enum:coding-assistants:leaders');

  const cats = [{ slug: 'a' }, { slug: 'b' }];
  assert.deepEqual(toolingPlan(cats, 'weekly'), ['cat:a', 'cat:b', 'ph']);
  assert.deepEqual(toolingPlan(cats, 'pull'), [
    'enum:a:leaders', 'enum:a:emerging', 'enum:b:leaders', 'enum:b:emerging', 'cat:a', 'cat:b', 'ph',
  ]);
});

check('nextUnswept: first unit not in swept, null when all swept', () => {
  const units = ['cat:a', 'cat:b', 'ph'];
  assert.equal(nextUnswept(units, []), 'cat:a');
  assert.equal(nextUnswept(units, ['cat:a']), 'cat:b');
  assert.equal(nextUnswept(units, ['cat:a', 'cat:b', 'ph']), null);
});

check('clampFit: clamps onto 0-100 int, null on non-numeric', () => {
  assert.equal(clampFit(45.6), 46);
  assert.equal(clampFit(150), 100);
  assert.equal(clampFit(-5), 0);
  assert.equal(clampFit('72'), 72);
  assert.equal(clampFit('high'), null);
  assert.equal(clampFit(undefined), null);
});

check('isNewsHost: exact and parent-domain match, unknown host false', () => {
  assert.ok(isNewsHost('techcrunch.com'));
  assert.ok(isNewsHost('www.techcrunch.com'));
  assert.ok(isNewsHost('news.ycombinator.com'));
  assert.ok(isNewsHost('item.news.ycombinator.com'));
  assert.ok(!isNewsHost('acme-startup.com'));
  assert.ok(!isNewsHost(''));
});

check('resolveToolingTokens: resolves {year}/{month} from the given day, falls back on a bad day', () => {
  assert.equal(resolveToolingTokens('new tool launch {month} {year}', '2026-03-15'), 'new tool launch March 2026');
  assert.equal(resolveToolingTokens('no tokens here', '2026-03-15'), 'no tokens here');
  assert.equal(typeof resolveToolingTokens('{year}', 'not-a-date'), 'string');
});

// isProductUrl: repo paths on aggregator roots are homepages, news roots are not.
check('isProductUrl accepts a plain vendor site', () => assert.equal(isProductUrl('https://www.langfuse.com/'), true));
check('isProductUrl accepts a GitHub repo path', () => assert.equal(isProductUrl('https://github.com/deepset-ai/haystack'), true));
check('isProductUrl rejects the GitHub root and a user page', () => {
  assert.equal(isProductUrl('https://github.com/'), false);
  assert.equal(isProductUrl('https://github.com/deepset-ai'), false);
});
check('isProductUrl rejects news and aggregator hosts', () => {
  assert.equal(isProductUrl('https://techcrunch.com/2026/09/17/some-launch/'), false);
  assert.equal(isProductUrl('https://news.ycombinator.com/item?id=1'), false);
});
check('isProductUrl rejects non-http and garbage', () => {
  assert.equal(isProductUrl('ftp://example.com/x'), false);
  assert.equal(isProductUrl('not a url'), false);
});

// ---- DB round-trip (read-only), guarded: migration 0054 may not be applied ----

const client = process.env.DATABASE_URL
  ? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new pg.Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
await client.connect();

const { rows: regRows } = await client.query(`select to_regclass('public.tooling_products') as reg`);
if (!regRows[0]?.reg) {
  console.log('\nDB checks skipped: migration 0054 not applied');
  await client.end();
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const { rows: products } = await client.query(`select name, name_key from tooling_products limit 50`);
check(`productNameKey mirrors the generated column (${products.length} rows)`, () => {
  for (const r of products) assert.equal(productNameKey(r.name), r.name_key, `mismatch for "${r.name}"`);
});

const { rows: prefsRows } = await client.query(`select id from tooling_prefs where id = true`);
check('tooling_prefs singleton row exists', () => {
  assert.equal(prefsRows.length, 1);
});

const { rows: catRows } = await client.query(`select count(*)::int as n from tooling_categories`);
check('tooling_categories has at least 10 seeded rows', () => {
  assert.ok((catRows[0]?.n ?? 0) >= 10, `only ${catRows[0]?.n} categories`);
});

await client.end();

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

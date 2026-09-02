// Tests for the External Scan's deterministic core: the hand-rolled RSS/Atom
// parser, window filtering, relevance clamping, and the search-topic planner.
// READ-ONLY: never writes a row. Node type stripping loads the .ts module.
// Run: node scripts/test-scan.mjs   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  parseFeedXml, decodeEntities, withinWindow, clamp01, nextSearchTopic, lookbackDays,
  mapTavilyResults, extractJsonObject, gdeltSafeQuery,
} from '../lib/scan/core.ts';
import { SCAN_ENRICH_MODELS, pickEnrichModel, isScanEnrichModel } from '../lib/scan/models.ts';
import {
  buildScanHandoff, buildSignalsExportHandoff, buildRowJsonSchema, cronLabel,
} from '../lib/scan/handoff.ts';
import { getDataset } from '../lib/datasets/registry.ts';
import { isGdeltTransportError, gdeltAvailable, markGdeltDown } from '../lib/scan/search-gdelt.ts';
import {
  rateDomainByRule, priorityOf, normalizeDomain, KIND_TIER, curatedDomainCount, isContentKind,
} from '../lib/scan/source-tiers.ts';
import { acceptDomainRatings } from '../lib/scan/source-rating-core.ts';

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
async function checkAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('scan core:');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Press</title>
<item>
  <title><![CDATA[Fed &amp; OCC issue joint guidance]]></title>
  <link>https://example.gov/press/2026/a</link>
  <pubDate>Tue, 25 Aug 2026 14:30:00 GMT</pubDate>
</item>
<item>
  <title>Rule &#8220;finalized&#8221; today</title>
  <link>https://example.gov/press/2026/b?utm_source=rss</link>
  <dc:date>2026-08-27T09:00:00Z</dc:date>
</item>
<item>
  <title>No link item</title>
  <pubDate>Mon, 24 Aug 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Dateless item</title>
  <link>https://example.gov/press/2026/c</link>
</item>
</channel></rss>`;

check('parseFeedXml reads RSS 2.0 items (CDATA, entities, dc:date, linkless drop)', () => {
  const items = parseFeedXml(RSS);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Fed & OCC issue joint guidance');
  assert.equal(items[0].url, 'https://example.gov/press/2026/a');
  assert.equal(items[0].publishedISO, '2026-08-25');
  assert.ok(items[1].title.includes('finalized'));
  assert.equal(items[1].publishedISO, '2026-08-27');
  assert.equal(items[2].title, 'Dateless item');
  assert.equal(items[2].publishedISO, null);
});

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Agency updates</title>
<entry>
  <title>Enforcement action announced</title>
  <link rel="self" href="https://example.gov/api/entry/1"/>
  <link rel="alternate" href="https://example.gov/news/1"/>
  <published>2026-08-26T12:00:00Z</published>
</entry>
<entry>
  <title>Speech: outlook</title>
  <link href="https://example.gov/news/2"/>
  <updated>2026-08-27T08:00:00-04:00</updated>
</entry>
</feed>`;

check('parseFeedXml reads Atom entries (rel=alternate preferred, updated fallback)', () => {
  const items = parseFeedXml(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://example.gov/news/1');
  assert.equal(items[0].publishedISO, '2026-08-26');
  assert.equal(items[1].url, 'https://example.gov/news/2');
  assert.equal(items[1].publishedISO, '2026-08-27');
});

check('parseFeedXml returns [] on junk and respects maxItems', () => {
  assert.deepEqual(parseFeedXml('not xml at all'), []);
  assert.deepEqual(parseFeedXml(''), []);
  const many = `<rss><channel>${Array.from({ length: 9 }, (_, i) =>
    `<item><title>t${i}</title><link>https://x.com/${i}</link></item>`).join('')}</channel></rss>`;
  assert.equal(parseFeedXml(many, 4).length, 4);
});

check('decodeEntities handles numeric, hex, and named without double-decoding', () => {
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('a &quot;b&quot; &apos;c&apos;'), `a "b" 'c'`);
});

check('withinWindow: null passes, boundary inclusive', () => {
  assert.ok(withinWindow(null, '2026-08-27'));
  assert.ok(withinWindow('2026-08-27', '2026-08-27'));
  assert.ok(withinWindow('2026-08-28', '2026-08-27'));
  assert.ok(!withinWindow('2026-08-26', '2026-08-27'));
});

check('clamp01 clamps onto numeric(3,2)', () => {
  assert.equal(clamp01(0.456), 0.46);
  assert.equal(clamp01(7), 1);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01('0.5'), 0.5);
  assert.equal(clamp01('high'), null);
  assert.equal(clamp01(undefined), null);
});

check('lookbackDays: Monday reaches back through the weekend, other days one', () => {
  assert.equal(lookbackDays('2026-08-31'), 3); // Monday
  assert.equal(lookbackDays('2026-08-28'), 1); // Friday
  assert.equal(lookbackDays('2026-08-29'), 1); // Saturday (manual run)
  assert.equal(lookbackDays('2026-09-01'), 1); // Tuesday
});

check('nextSearchTopic skips inactive, feeds-only, and searched topics', () => {
  const topics = [
    { slug: 'a', active: true, search_queries: [] },
    { slug: 'b', active: false, search_queries: ['q'] },
    { slug: 'c', active: true, search_queries: ['q'] },
    { slug: 'd', active: true, search_queries: ['q'] },
  ];
  assert.equal(nextSearchTopic(topics, [])?.slug, 'c');
  assert.equal(nextSearchTopic(topics, ['c'])?.slug, 'd');
  assert.equal(nextSearchTopic(topics, ['c', 'd']), null);
});

check('mapTavilyResults: maps, blocks by suffix, normalizes dates, drops junk', () => {
  const items = mapTavilyResults(
    [
      { title: 'Fed rule', url: 'https://www.example.gov/a', published_date: 'Fri, 28 Aug 2026 10:00:00 GMT' },
      { title: 'PR spam', url: 'https://news.prnewswire.com/x', published_date: '2026-08-28' },
      { title: 'No date', url: 'https://example.com/b' },
      { title: 'Junk', url: 'not-a-url' },
    ],
    ['prnewswire.com']
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].source_domain, 'example.gov');
  assert.equal(items[0].published_date, '2026-08-28');
  assert.equal(items[1].published_date, '');
});

check('gdeltSafeQuery: expands short tokens, keeps phrases, drops strays', () => {
  // GDELT rejects any unquoted keyword under 3 chars ("keyword too short").
  assert.equal(
    gdeltSafeQuery('most significant AI developments news September 2026'),
    'most significant "artificial intelligence" developments news September 2026'
  );
  assert.equal(
    gdeltSafeQuery('US tariff announcement impact banks'),
    '"United States" tariff announcement impact banks'
  );
  // Quoted phrases pass through untouched; other short strays drop.
  assert.equal(gdeltSafeQuery('"AI agents" at 5G scale'), '"AI agents" scale');
  // Pure numbers survive (years in date-token queries).
  assert.equal(gdeltSafeQuery('outlook 2026'), 'outlook 2026');
});

check('isGdeltTransportError: flags only errors marked transport', () => {
  assert.equal(isGdeltTransportError(new Error('plain failure')), false);
  const marked = new Error('GDELT 503: down');
  marked.transport = true;
  assert.equal(isGdeltTransportError(marked), true);
  assert.equal(isGdeltTransportError(null), false);
  assert.equal(isGdeltTransportError('not an error object'), false);
});

await checkAsync('gdelt circuit breaker: available by default, unavailable after markGdeltDown, available again after its window', async () => {
  assert.equal(gdeltAvailable(), true);
  markGdeltDown(60);
  assert.equal(gdeltAvailable(), false);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(gdeltAvailable(), true);
});

check('extractJsonObject: clean, fenced, prose-wrapped, nested, braces in strings', () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJsonObject('Sure!\n```json\n{"a":{"b":2}}\n```\nDone.'), { a: { b: 2 } });
  assert.deepEqual(extractJsonObject('note {"s":"has } brace","n":3} trailing'), { s: 'has } brace', n: 3 });
  assert.throws(() => extractJsonObject('no json here'));
  assert.throws(() => extractJsonObject('{"unterminated": tr'));
});

check('pickEnrichModel: deterministic, roughly balanced, null on empty', () => {
  assert.equal(pickEnrichModel([], 'abc'), null);
  const models = ['m1', 'm2'];
  const id = '872251fe-0000-0000-0000-000000000000';
  assert.equal(pickEnrichModel(models, id), pickEnrichModel(models, id));
  const counts = { m1: 0, m2: 0 };
  for (let i = 0; i < 200; i++) {
    const fake = i.toString(16).padStart(8, '0') + '-x';
    counts[pickEnrichModel(models, fake)] += 1;
  }
  assert.ok(counts.m1 > 50 && counts.m2 > 50, `skewed split ${counts.m1}/${counts.m2}`);
});

check('model registry: valid ids, exactly one Anthropic baseline', () => {
  assert.ok(SCAN_ENRICH_MODELS.length >= 3);
  for (const m of SCAN_ENRICH_MODELS) assert.ok(isScanEnrichModel(m.id));
  assert.ok(!isScanEnrichModel('gpt-nonexistent'));
  assert.equal(SCAN_ENRICH_MODELS.filter((m) => m.anthropic).length, 1);
});

// ---- The importer handoff: schema generation must track the registry ------

const scanDef = getDataset('external-scan');

check('buildRowJsonSchema covers every registry column with real facts', () => {
  assert.ok(scanDef, 'external-scan def missing from the registry');
  const schema = buildRowJsonSchema(scanDef);
  for (const c of scanDef.columns) {
    const p = schema.properties[c.key];
    assert.ok(p, `no schema property for ${c.key}`);
    // The permissive fallback (['string','number','null']) means FIELD_FACTS
    // in lib/scan/handoff.ts was not updated for a new column: fix it there.
    assert.ok(
      !(Array.isArray(p.type) && p.type.length === 3),
      `${c.key} fell back to the permissive type; add it to FIELD_FACTS`
    );
  }
  assert.deepEqual(schema.required, scanDef.columns.map((c) => c.key));
});

check('buildScanHandoff embeds every column key and a parseable JSON Schema', () => {
  const text = buildScanHandoff({
    def: scanDef,
    topics: [{ slug: 't', name: 'Topic', description: 'd', taxonomy_code: '1.1', search_queries: ['q'], feed_urls: [], active: true, created_at: '' }],
    crons: [{ path: '/api/cron/scan', schedule: '0 9 * * *' }],
    host: 'https://example.test',
    generatedOn: '2026-08-28',
  });
  for (const c of scanDef.columns) assert.ok(text.includes(`| ${c.key} |`), `handoff missing ${c.key}`);
  const fenced = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(fenced, 'no fenced JSON Schema block');
  const parsed = JSON.parse(fenced[1]);
  assert.equal(parsed.properties.rows.items.title, 'external-scan row');
  assert.ok(text.includes('1.1'), 'taxonomy codes missing');
  assert.ok(!text.includes('—'), 'handoff contains an em dash');
});

check('cronLabel renders daily and weekday crons, passes odd schedules through', () => {
  assert.equal(cronLabel('0 9 * * *'), '09:00 UTC daily');
  assert.equal(cronLabel('30 11 * * *'), '11:30 UTC daily');
  assert.equal(cronLabel('0 9 * * 1-5'), '09:00 UTC weekdays');
  assert.equal(cronLabel('0 9 * * 6'), '0 9 * * 6');
});

// ---- The signals-export sibling: same schema machinery, second def --------

const signalsDef = getDataset('signals-export');

check('signals-export: leading columns mirror external-scan key for key', () => {
  assert.ok(signalsDef, 'signals-export def missing from the registry');
  // The mirrored/shared prefix is the base scan-item shape, through
  // enriched_by; external-scan appends its own source-reliability columns
  // after that (source_tier..priority, migration 0052) which signals-export
  // deliberately does not carry (a signal is human-edited, not source-scored),
  // so the comparison is against that shared prefix, not the full (longer)
  // external-scan column list.
  const scanKeys = scanDef.columns.map((c) => c.key);
  const sharedLen = scanKeys.indexOf('enriched_by') + 1;
  const sigKeys = signalsDef.columns.slice(0, sharedLen).map((c) => c.key);
  assert.deepEqual(sigKeys, scanKeys.slice(0, sharedLen));
});

check('signals-export: buildRowJsonSchema covers every column with real facts', () => {
  const schema = buildRowJsonSchema(signalsDef);
  for (const c of signalsDef.columns) {
    const p = schema.properties[c.key];
    assert.ok(p, `no schema property for ${c.key}`);
    assert.ok(
      !(Array.isArray(p.type) && p.type.length === 3),
      `${c.key} fell back to the permissive type; add it to FIELD_FACTS`
    );
  }
  assert.deepEqual(schema.required, signalsDef.columns.map((c) => c.key));
});

check('buildSignalsExportHandoff embeds every column and a parseable JSON Schema', () => {
  const text = buildSignalsExportHandoff({
    def: signalsDef,
    host: 'https://example.test',
    generatedOn: '2026-08-29',
  });
  for (const c of signalsDef.columns) assert.ok(text.includes(`| ${c.key} |`), `handoff missing ${c.key}`);
  const fenced = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(fenced, 'no fenced JSON Schema block');
  const parsed = JSON.parse(fenced[1]);
  assert.equal(parsed.properties.rows.items.title, 'signals-export row');
  assert.equal(parsed.properties.dataset.properties.slug.const, 'signals-export');
  assert.ok(!text.includes('—'), 'handoff contains an em dash');
});

// DB sanity (read-only): the 0038 tables exist and no run holds a duplicate
// normalized_url (the unique constraint's live proof).
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

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('scan_topics', 'scan_runs', 'scan_items')`
);
check('0038 tables present', () => {
  assert.equal(tables.length, 3);
});

const { rows: dupes } = await client.query(
  `select run_id, normalized_url, count(*) from scan_items
    group by run_id, normalized_url having count(*) > 1 limit 1`
);
check('no duplicate normalized_url within any run', () => {
  assert.equal(dupes.length, 0);
});

// Every non-Anthropic registry model must have a rate card (0041), or its
// calls log at cost 0 and checkScanBudget goes blind on that model.
const orIds = SCAN_ENRICH_MODELS.filter((m) => !m.anthropic).map((m) => m.id);
const { rows: carded } = await client.query(
  `select distinct model from ai_rate_cards where model = any($1::text[])`,
  [orIds]
);
check('every OpenRouter registry model has a rate card', () => {
  const have = new Set(carded.map((r) => r.model));
  for (const id of orIds) assert.ok(have.has(id), `no rate card for ${id}`);
});

await client.end();

// ---- source tiers (0052): rules are deterministic and cover the known volume ----
check('source tiers: suffix rules', () => {
  assert.deepEqual(rateDomainByRule('www.consumerfinance.gov'), { tier: 1, kind: 'regulator', via: 'suffix' });
  assert.equal(rateDomainByRule('fca.org.uk')?.kind, 'regulator');
  assert.equal(rateDomainByRule('brookings.edu')?.tier, 1);
  assert.equal(rateDomainByRule('someone.substack.com')?.kind, 'blog');
  assert.equal(rateDomainByRule('gov'), null, 'a bare suffix is not a domain');
});
check('source tiers: curated map + parent-domain walk', () => {
  assert.deepEqual(rateDomainByRule('ipsos.com'), { tier: 1, kind: 'research', via: 'curated' });
  assert.equal(rateDomainByRule('news.bloomberg.com')?.kind, 'major');
  assert.equal(rateDomainByRule('www.bankingdive.com')?.tier, 2);
  assert.equal(rateDomainByRule('whalesbook.com')?.tier, 4);
  assert.equal(rateDomainByRule('prnewswire.com')?.kind, 'pr_wire');
  assert.equal(rateDomainByRule('forbes.com')?.tier, 3, 'a curated tier override wins over the kind default');
  assert.equal(rateDomainByRule('completely-unknown-site.example'), null);
  assert.ok(curatedDomainCount() > 150);
  for (const [kind, tier] of Object.entries(KIND_TIER)) assert.ok(tier >= 1 && tier <= 4, kind);
});
check('source rating: a model-rated primary caps at tier 2', () => {
  const rows = acceptDomainRatings(
    { ratings: [{ domain: 'nascar.com', kind: 'primary', tier: 1, reason: 'official site' }] },
    [{ domain: 'nascar.com', sample_headline: null }]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, 2);
});
check('source tiers: priority composes relevance, tier, content kind', () => {
  assert.equal(priorityOf(0.8, 1, 'news'), 0.8);
  assert.equal(priorityOf(0.8, 4, 'news'), 0.2);
  assert.equal(priorityOf(0.8, 2, 'press_release'), 0.48);
  assert.equal(priorityOf(0.8, null, null), 0.41, 'unrated = tier 3 and other');
  assert.equal(priorityOf(null, 1, 'news'), null);
  assert.equal(priorityOf(1.7, 1, 'news'), 1, 'clamped');
  assert.equal(normalizeDomain('WWW.Ipsos.com.'), 'ipsos.com');
  assert.ok(isContentKind('data') && !isContentKind('rumor'));
});

// ---- source rating (0052): the model-rating decision validator is pure ----
const RATING_CANDIDATES = [
  { domain: 'example-news.test', sample_headline: 'Bank announces new product' },
  { domain: 'example-blog.test', sample_headline: 'Why I quit my job' },
];

check('acceptDomainRatings: accepts a valid rating and normalizes the domain', () => {
  const rows = acceptDomainRatings(
    { ratings: [{ domain: 'WWW.Example-News.test.', kind: 'major', tier: 2, reason: 'A national outlet.' }] },
    RATING_CANDIDATES
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].domain, 'example-news.test');
  assert.equal(rows[0].kind, 'major');
  assert.equal(rows[0].tier, 2);
  assert.equal(rows[0].rated_by, 'model');
  assert.equal(rows[0].reason, 'A national outlet.');
  assert.equal(rows[0].sample_headline, 'Bank announces new product');
});

check('acceptDomainRatings: drops an invalid kind, a domain outside the batch, and a repeat', () => {
  const rows = acceptDomainRatings(
    {
      ratings: [
        { domain: 'example-news.test', kind: 'not-a-kind', tier: 2, reason: 'x' },
        { domain: 'not-in-batch.test', kind: 'major', tier: 2, reason: 'x' },
        { domain: 'example-blog.test', kind: 'blog', tier: 3, reason: 'first' },
        { domain: 'example-blog.test', kind: 'blog', tier: 4, reason: 'second, should be dropped' },
      ],
    },
    RATING_CANDIDATES
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].domain, 'example-blog.test');
  assert.equal(rows[0].reason, 'first');
});

check('acceptDomainRatings: clamps the tier to the kind default or one step weaker, never stronger', () => {
  // major defaults to tier 2: a model claiming tier 1 (stronger) clamps to 2.
  const tooStrong = acceptDomainRatings(
    { ratings: [{ domain: 'example-news.test', kind: 'major', tier: 1, reason: 'x' }] },
    RATING_CANDIDATES
  );
  assert.equal(tooStrong[0].tier, 2);
  // one step weaker than the kind default (2 -> 3) is allowed.
  const oneWeaker = acceptDomainRatings(
    { ratings: [{ domain: 'example-news.test', kind: 'major', tier: 3, reason: 'x' }] },
    RATING_CANDIDATES
  );
  assert.equal(oneWeaker[0].tier, 3);
  // two steps weaker (2 -> 4) clamps back to one step weaker (3).
  const tooWeak = acceptDomainRatings(
    { ratings: [{ domain: 'example-news.test', kind: 'major', tier: 4, reason: 'x' }] },
    RATING_CANDIDATES
  );
  assert.equal(tooWeak[0].tier, 3);
});

check('acceptDomainRatings: malformed input yields no rows', () => {
  assert.deepEqual(acceptDomainRatings(null, RATING_CANDIDATES), []);
  assert.deepEqual(acceptDomainRatings({}, RATING_CANDIDATES), []);
  assert.deepEqual(acceptDomainRatings({ ratings: 'not an array' }, RATING_CANDIDATES), []);
});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

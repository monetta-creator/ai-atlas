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
} from '../lib/scan/core.ts';
import {
  buildScanHandoff, buildSignalsExportHandoff, buildRowJsonSchema, cronLabel,
} from '../lib/scan/handoff.ts';
import { getDataset } from '../lib/datasets/registry.ts';

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

check('signals-export: first nineteen columns mirror external-scan key for key', () => {
  assert.ok(signalsDef, 'signals-export def missing from the registry');
  const scanKeys = scanDef.columns.map((c) => c.key);
  const sigKeys = signalsDef.columns.slice(0, scanKeys.length).map((c) => c.key);
  assert.deepEqual(sigKeys, scanKeys);
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

await client.end();

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

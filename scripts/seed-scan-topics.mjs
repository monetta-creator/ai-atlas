import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Seed for the External Scan's topic registry (migration 0038). Reads the
// PRIVATE topic file — private/scan-topics.json (untracked; the repo is public
// and the real topic set must never be committed) — or a path given as the
// first argument. Idempotent: upserts on slug, updating everything EXCEPT
// `active` (the /scan console toggle owns that after first insert). Never
// deletes; topics present in the DB but absent from the JSON are reported.
// Run with: npm run db:seed:scan   (or: node scripts/seed-scan-topics.mjs path.json)
//
// JSON format, one entry per topic:
// [{
//   "slug": "monetary-policy",             // ^[a-z0-9][a-z0-9-]{1,60}$
//   "name": "Monetary policy and yield curves",
//   "description": "Policy rate moves, yield curve shifts, benchmark rates.",
//   "taxonomy_code": "1.1",
//   "search_queries": ["Federal Reserve rate decision {month} {year}"],  // [] = feeds-only
//   "feed_urls": ["https://www.federalreserve.gov/feeds/press_all.xml"],
//   "active": true                          // applied on INSERT only
// }]

const path = process.argv[2] ?? 'private/scan-topics.json';
let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch {
  console.error(`Cannot read ${path}.`);
  console.error('Create private/scan-topics.json (see the JSON format in this script\'s header).');
  console.error('The real topic set lives ONLY in private/ — never commit it.');
  process.exit(1);
}

let topics;
try {
  topics = JSON.parse(raw);
} catch (e) {
  console.error(`${path} is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(topics) || !topics.length) {
  console.error(`${path} must be a non-empty JSON array of topics.`);
  process.exit(1);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim());
const errors = [];
for (const [i, t] of topics.entries()) {
  const where = `entry ${i} (${t?.slug ?? 'no slug'})`;
  if (!SLUG_RE.test(t?.slug ?? '')) errors.push(`${where}: bad slug`);
  if (typeof t?.name !== 'string' || !t.name.trim()) errors.push(`${where}: name required`);
  if (typeof t?.taxonomy_code !== 'string' || !t.taxonomy_code.trim()) errors.push(`${where}: taxonomy_code required`);
  if (!isStrArray(t?.search_queries ?? [])) errors.push(`${where}: search_queries must be an array of strings`);
  if (!isStrArray(t?.feed_urls ?? [])) errors.push(`${where}: feed_urls must be an array of strings`);
  for (const u of t?.feed_urls ?? []) {
    if (!/^https?:\/\//i.test(u)) errors.push(`${where}: feed_urls entry is not http(s): ${u}`);
  }
}
if (errors.length) {
  for (const e of errors) console.error(`invalid: ${e}`);
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

let upserted = 0;
for (const t of topics) {
  await client.query(
    `insert into scan_topics (slug, name, description, taxonomy_code, search_queries, feed_urls, active)
     values ($1, $2, $3, $4, $5::text[], $6::text[], $7)
     on conflict (slug) do update set
       name = excluded.name,
       description = excluded.description,
       taxonomy_code = excluded.taxonomy_code,
       search_queries = excluded.search_queries,
       feed_urls = excluded.feed_urls`,
    [
      t.slug, t.name.trim(), t.description?.trim() || null, t.taxonomy_code.trim(),
      t.search_queries ?? [], t.feed_urls ?? [], t.active !== false,
    ]
  );
  upserted += 1;
}

const { rows: dbOnly } = await client.query(
  `select slug from scan_topics where not (slug = any($1::text[])) order by slug`,
  [topics.map((t) => t.slug)]
);

console.log(`Upserted ${upserted} topics from ${path}.`);
if (dbOnly.length) {
  console.log(`In DB but not in the file (kept, never deleted): ${dbOnly.map((r) => r.slug).join(', ')}`);
}

await client.end();

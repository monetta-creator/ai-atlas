import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Seed for the AI Tooling Monitor's category registry (migration 0054).
// Overlays the PRIVATE category file — private/tooling-categories.json
// (untracked; the repo is public and the real category set should stay
// editorial, not baked into a migration) — onto the generic starter set the
// migration already seeded. Idempotent: upserts on slug, OVERWRITING queries
// when the file provides them (unlike scan's seed, which never touches
// `active` after first insert, this seed is meant to be the admin's editable
// source of truth, so every run reflects the file). Never deletes; categories
// present in the DB but absent from the file are reported, not removed.
// Run with: npm run db:seed:tooling   (or: node scripts/seed-tooling.mjs path.json)
//
// JSON format, one entry per category:
// [{
//   "slug": "coding-assistants",             // ^[a-z0-9][a-z0-9-]{1,60}$
//   "name": "Coding assistants",
//   "description": "AI-assisted software development tools.",
//   "search_queries": ["new AI coding assistant launch {month} {year}"],
//   "pull_queries": ["best AI coding assistants for enterprise teams"],
//   "hn_query": "AI coding assistant",
//   "github_query": "AI coding assistant",
//   "active": true,                          // default true
//   "sort_order": 10                          // default 0
// }]

const path = process.argv[2] ?? 'private/tooling-categories.json';
let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch {
  console.log(`No ${path} found; the migration's generic starter categories stand.`);
  console.log('Create private/tooling-categories.json to overlay the real category registry (see this script\'s header for the format).');
  process.exit(0);
}

let categories;
try {
  categories = JSON.parse(raw);
} catch (e) {
  console.error(`${path} is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(categories) || !categories.length) {
  console.error(`${path} must be a non-empty JSON array of categories.`);
  process.exit(1);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim());
const errors = [];
for (const [i, c] of categories.entries()) {
  const where = `entry ${i} (${c?.slug ?? 'no slug'})`;
  if (!SLUG_RE.test(c?.slug ?? '')) errors.push(`${where}: bad slug`);
  if (typeof c?.name !== 'string' || !c.name.trim()) errors.push(`${where}: name required`);
  if (!isStrArray(c?.search_queries ?? [])) errors.push(`${where}: search_queries must be an array of strings`);
  if (!isStrArray(c?.pull_queries ?? [])) errors.push(`${where}: pull_queries must be an array of strings`);
  if (c?.hn_query != null && typeof c.hn_query !== 'string') errors.push(`${where}: hn_query must be a string`);
  if (c?.github_query != null && typeof c.github_query !== 'string') errors.push(`${where}: github_query must be a string`);
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
for (const c of categories) {
  await client.query(
    `insert into tooling_categories
       (slug, name, description, search_queries, pull_queries, hn_query, github_query, active, sort_order)
     values ($1, $2, $3, $4::text[], $5::text[], $6, $7, $8, $9)
     on conflict (slug) do update set
       name = excluded.name,
       description = excluded.description,
       search_queries = excluded.search_queries,
       pull_queries = excluded.pull_queries,
       hn_query = excluded.hn_query,
       github_query = excluded.github_query,
       active = excluded.active,
       sort_order = excluded.sort_order,
       updated_at = now()`,
    [
      c.slug, c.name.trim(), c.description?.trim() || null,
      c.search_queries ?? [], c.pull_queries ?? [],
      c.hn_query?.trim() || null, c.github_query?.trim() || null,
      c.active !== false, Number.isFinite(c.sort_order) ? c.sort_order : 0,
    ]
  );
  upserted += 1;
}

const { rows: dbOnly } = await client.query(
  `select slug from tooling_categories where not (slug = any($1::text[])) order by slug`,
  [categories.map((c) => c.slug)]
);

console.log(`Upserted ${upserted} categories from ${path}.`);
if (dbOnly.length) {
  console.log(`In DB but not in the file (kept, never deleted): ${dbOnly.map((r) => r.slug).join(', ')}`);
}

await client.end();

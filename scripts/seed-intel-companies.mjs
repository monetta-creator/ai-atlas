import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Seed for the Intel Desk's company registry (migration 0043). Reads the
// PRIVATE company file — private/intel-companies.json (untracked; the repo is
// public and the real registry must never be committed) — or a path given as
// the first argument. Idempotent: upserts on slug, updating everything listed
// below but never `active` (the /intel console owns it after first insert)
// or `dossier`/`notes` (enrichment and the admin own those).
// Run with: npm run db:seed:intel   (or: node scripts/seed-intel-companies.mjs path.json)
//
// JSON format, one entry per company:
// [{
//   "slug": "example-bank",                 // ^[a-z0-9][a-z0-9-]{1,60}$
//   "name": "Example Bancorp",
//   "tier": "consumer_bank",                // self | card_issuer | consumer_bank | fintech | tech_platform | wildcard
//   "niche": "cards",                       // optional
//   "ticker": "EXBK",                       // optional; drives CIK auto-resolve when cik is absent
//   "cik": "0000320193",                    // optional; digits only
//   "rssd_id": "1234567",                   // optional
//   "fdic_cert": "12345",                   // optional
//   "lei": "549300ABCDEF12345678",          // optional
//   "domain": "examplebancorp.com",         // optional
//   "aliases": ["Example Bancorp"],         // optional; defaults to [name]
//   "feed_urls": ["https://..."],           // optional; defaults to one Google News RSS URL
//   "search_queries": ["Example Bancorp strategy announcement {month} {year}"],  // optional; defaults to []
//   "ats": { "provider": "greenhouse", "board": "example" }  // optional; "greenhouse" | "lever"
// }]

const path = process.argv[2] ?? 'private/intel-companies.json';
let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch {
  console.error(`Cannot read ${path}.`);
  console.error('Create private/intel-companies.json (see the JSON format in this script\'s header).');
  console.error('The real company registry lives ONLY in private/ and must never be committed.');
  process.exit(1);
}

let companies;
try {
  companies = JSON.parse(raw);
} catch (e) {
  console.error(`${path} is not valid JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(companies) || !companies.length) {
  console.error(`${path} must be a non-empty JSON array of companies.`);
  process.exit(1);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const CIK_RE = /^[0-9]+$/;
const TIERS = ['self', 'card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'];
const ATS_PROVIDERS = ['greenhouse', 'lever'];
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim());

const errors = [];
for (const [i, c] of companies.entries()) {
  const where = `entry ${i} (${c?.slug ?? 'no slug'})`;
  if (!SLUG_RE.test(c?.slug ?? '')) errors.push(`${where}: bad slug`);
  if (typeof c?.name !== 'string' || !c.name.trim()) errors.push(`${where}: name required`);
  if (typeof c?.tier !== 'string' || !c.tier.trim()) errors.push(`${where}: tier required`);
  else if (!TIERS.includes(c.tier)) errors.push(`${where}: invalid tier "${c.tier}" (must be one of ${TIERS.join(', ')})`);
  if (c?.aliases !== undefined && !isStrArray(c.aliases)) errors.push(`${where}: aliases must be an array of strings`);
  if (c?.feed_urls !== undefined && !isStrArray(c.feed_urls)) errors.push(`${where}: feed_urls must be an array of strings`);
  if (c?.search_queries !== undefined && !isStrArray(c.search_queries)) errors.push(`${where}: search_queries must be an array of strings`);
  for (const u of c?.feed_urls ?? []) {
    if (!/^https?:\/\//i.test(u)) errors.push(`${where}: feed_urls entry is not http(s): ${u}`);
  }
  if (c?.cik !== undefined && c?.cik !== null && !CIK_RE.test(String(c.cik))) {
    errors.push(`${where}: cik must be digits only, got "${c.cik}"`);
  }
  if (c?.ats !== undefined && c?.ats !== null) {
    if (typeof c.ats !== 'object' || Array.isArray(c.ats)) {
      errors.push(`${where}: ats must be an object`);
    } else {
      if (!ATS_PROVIDERS.includes(c.ats.provider)) {
        errors.push(`${where}: ats.provider must be one of ${ATS_PROVIDERS.join(', ')}`);
      }
      if (typeof c.ats.board !== 'string' || !c.ats.board.trim()) {
        errors.push(`${where}: ats.board is required`);
      }
    }
  }
}

const slugCounts = new Map();
const domainCounts = new Map();
for (const c of companies) {
  if (typeof c?.slug === 'string') slugCounts.set(c.slug, (slugCounts.get(c.slug) ?? 0) + 1);
  const domain = typeof c?.domain === 'string' && c.domain.trim() ? c.domain.trim().toLowerCase() : null;
  if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
}
for (const [slug, count] of slugCounts) {
  if (count > 1) errors.push(`duplicate slug across file: ${slug} (${count} entries collapse to one row)`);
}
for (const [domain, count] of domainCounts) {
  if (count > 1) errors.push(`duplicate domain across file: ${domain} (${count} entries collapse to one row)`);
}

if (errors.length) {
  for (const e of errors) console.error(`invalid: ${e}`);
  process.exit(1);
}

// Reimplemented from lib/intel/core.ts bingNewsFeedUrl (an .mjs script
// cannot import the .ts): the free default feed for a company, Google News
// RSS on an exact-phrase search.
function bingNewsFeedUrl(phrase) {
  const q = encodeURIComponent(`"${phrase}"`);
  return `https://www.bing.com/news/search?q=${q}&format=RSS`;
}

for (const c of companies) {
  c.name = c.name.trim();
  if (!c.aliases || c.aliases.length === 0) c.aliases = [c.name];
  if (!c.feed_urls || c.feed_urls.length === 0) c.feed_urls = [bingNewsFeedUrl(c.name)];
}

// CIK auto-resolve: entries with a ticker but no cik get looked up against
// SEC's public ticker-to-CIK map, fetched once. A fetch failure warns and
// continues; it never blocks the seed.
const needCik = companies.filter((c) => c.ticker && !c.cik);
if (needCik.length) {
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': `ai-atlas-seed ${process.env.RESEARCH_CONTACT_EMAIL || 'contact@example.com'}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tickerToCik = new Map();
    for (const row of Object.values(data)) {
      if (row && row.ticker && row.cik_str != null) {
        tickerToCik.set(String(row.ticker).toUpperCase(), String(row.cik_str));
      }
    }
    let resolved = 0;
    for (const c of needCik) {
      const cik = tickerToCik.get(String(c.ticker).toUpperCase());
      if (cik) {
        c.cik = cik;
        resolved += 1;
      }
    }
    console.log(`Resolved ${resolved} of ${needCik.length} missing CIKs from SEC's ticker map.`);
  } catch (e) {
    console.warn(`Could not fetch the SEC ticker to CIK map (${e.message}). Continuing without auto-resolved CIKs.`);
  }
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
for (const c of companies) {
  await client.query(
    `insert into intel_companies (slug, name, tier, niche, ticker, cik, rssd_id, fdic_cert, lei, domain, aliases, feed_urls, search_queries, ats)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12::text[], $13::text[], $14::jsonb)
     on conflict (slug) do update set
       name = excluded.name,
       tier = excluded.tier,
       niche = excluded.niche,
       ticker = excluded.ticker,
       cik = excluded.cik,
       rssd_id = excluded.rssd_id,
       fdic_cert = excluded.fdic_cert,
       lei = excluded.lei,
       domain = excluded.domain,
       aliases = excluded.aliases,
       feed_urls = excluded.feed_urls,
       search_queries = excluded.search_queries,
       ats = excluded.ats`,
    [
      c.slug, c.name, c.tier, c.niche?.trim() || null, c.ticker?.trim() || null, c.cik ?? null,
      c.rssd_id?.trim() || null, c.fdic_cert?.trim() || null, c.lei?.trim() || null, c.domain?.trim() || null,
      c.aliases, c.feed_urls, c.search_queries ?? [],
      c.ats ? JSON.stringify({ provider: c.ats.provider, board: c.ats.board.trim() }) : null,
    ]
  );
  upserted += 1;
}

const { rows: dbOnly } = await client.query(
  `select slug from intel_companies where not (slug = any($1::text[])) order by slug`,
  [companies.map((c) => c.slug)]
);

console.log(`Upserted ${upserted} companies from ${path}.`);
if (dbOnly.length) {
  console.log(`In DB but not in the file (kept, never deleted): ${dbOnly.map((r) => r.slug).join(', ')}`);
}

await client.end();

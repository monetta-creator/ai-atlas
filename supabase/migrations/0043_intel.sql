-- 0043_intel.sql — the Intel Desk (/intel): a company-intelligence registry with
-- a daily collection engine and firewall export. Tracks a curated set of
-- companies across tiers, sweeps public sources (RSS/Google News feeds, Tavily
-- search, SEC EDGAR filings), retains full text, extracts structured facts, and
-- pulls LLM-free quarterly metrics (EDGAR XBRL / FDIC / CFPB). The day's output
-- publishes only as key-gated datasets for downstream import.
--
-- Boundaries this schema encodes:
--   * Companies are a registry table (the scan_topics precedent): rows, not
--     deploys. The REAL registry is seeded from private/intel-companies.json
--     (untracked) by scripts/seed-intel-companies.mjs; the seed below is a
--     generic fictional example so the public repo runs standalone.
--   * intel_runs keys on `day` and IS the checkpoint state (the scan_runs
--     pattern): swept_units holds per-leg-per-company checkpoints
--     ('feeds', 'search:<slug>', 'filings:<slug>'), lease_until guards
--     overlapping cron invocations, notes[] persists per-run issues.
--   * Fetch/enrich statuses reuse the scan enums — the legs are clones and the
--     semantics match exactly.
--   * intel_facts are additive and provenance-carrying: written only by
--     enrichment extraction, deduped per company on a normalized fact key,
--     each row pointing at the item it came from.
--   * intel_metrics are LLM-free structured series keyed by
--     (company, metric, period, source); re-fetches upsert idempotently.

create type intel_tier_t as enum
  ('self', 'card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard');
create type intel_step_t as enum
  ('feeds', 'search', 'filings', 'hydrate', 'enrich', 'complete');
create type intel_doc_t as enum
  ('news', 'press', 'filing', 'transcript', 'report');

-- ------------------------------------------------------------ intel_companies
-- The registry. aliases are exact search phrases (quoted in feed/search
-- queries); feed_urls are RSS/Atom (Google News RSS is the free default);
-- search_queries carry {year}/{month} tokens. The identifier columns
-- (ticker/cik/rssd_id/fdic_cert/lei) are the join keys the export ships so a
-- downstream importer can join licensed datasets onto this spine.
create table intel_companies (
  slug           text primary key,
  name           text not null,
  tier           intel_tier_t not null,
  niche          text,
  ticker         text,
  cik            text,
  rssd_id        text,
  fdic_cert      text,
  lei            text,
  domain         text,
  aliases        text[] not null default '{}',
  feed_urls      text[] not null default '{}',
  search_queries text[] not null default '{}',
  active         boolean not null default true,
  dossier        jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_intel_companies_updated
  before update on intel_companies
  for each row execute function set_updated_at();

alter table intel_companies enable row level security;

insert into intel_companies (slug, name, tier, niche, ticker, domain, aliases, feed_urls, search_queries) values
  ('example-bank', 'Example Bancorp', 'consumer_bank', null, 'EXBK', 'examplebancorp.com',
   array['Example Bancorp'],
   array['https://news.google.com/rss/search?q=%22Example%20Bancorp%22&hl=en-US&gl=US&ceid=US:en'],
   array['Example Bancorp strategy announcement {month} {year}']),
  ('example-fintech', 'Example Fintech', 'fintech', 'payments', null, 'examplefintech.io',
   array['Example Fintech'],
   array['https://news.google.com/rss/search?q=%22Example%20Fintech%22&hl=en-US&gl=US&ceid=US:en'],
   array['Example Fintech product launch {month} {year}'])
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- intel_runs
-- One row per UTC day; reuses run_status_t (0005). swept_units is the per-leg
-- checkpoint array; lease_until is the overlap guard; notes[] the persisted
-- issue log (appended deduped, capped by the writer).
create table intel_runs (
  id                uuid primary key default gen_random_uuid(),
  day               date not null unique,
  status            run_status_t not null default 'running',
  step              intel_step_t not null default 'feeds',
  swept_units       text[] not null default '{}',
  feed_item_count   int not null default 0,
  search_item_count int not null default 0,
  filing_item_count int not null default 0,
  hydrated_count    int not null default 0,
  enriched_count    int not null default 0,
  skipped_count     int not null default 0,
  fact_count        int not null default 0,
  metric_count      int not null default 0,
  error             text,
  lease_until       timestamptz,
  notes             text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_intel_runs_updated
  before update on intel_runs
  for each row execute function set_updated_at();

create index on intel_runs (day desc);
alter table intel_runs enable row level security;

-- --------------------------------------------------------------- intel_items
-- One discovered document. Column names deliberately mirror scan_items where
-- the semantics match — the intel-items dataset mirrors external-scan's
-- leading columns key for key so one downstream intake ingests both.
-- company_slug is the primary company; company_slugs holds every company the
-- enrichment linked (allow-listed against the registry). dimensions are the
-- taxonomy codes from lib/intel/core.ts, allow-listed at write time.
create table intel_items (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references intel_runs(id) on delete cascade,
  company_slug   text references intel_companies(slug),
  company_slugs  text[] not null default '{}',
  url            text not null,
  normalized_url text not null,
  headline       text,
  source_domain  text,
  published_date date,
  discovered_via text not null,
  doc_type       intel_doc_t not null default 'news',
  raw_content    text,
  fetched_via    text,
  fetch_status   scan_fetch_status_t  not null default 'pending',
  fetch_error    text,
  enrich_status  scan_enrich_status_t not null default 'pending',
  summary        text,
  dimensions     text[] not null default '{}',
  entities       text[] not null default '{}',
  significance   numeric(3,2),
  enriched_by    text,
  created_at     timestamptz not null default now(),
  unique (run_id, normalized_url)
);

create index intel_items_normurl_idx on intel_items (normalized_url, created_at desc);
create index on intel_items (run_id, fetch_status);
create index on intel_items (run_id, enrich_status);
create index on intel_items (company_slug, created_at desc);
alter table intel_items enable row level security;

-- --------------------------------------------------------------- intel_facts
-- A structured, provenance-carrying fact about a company, extracted by
-- enrichment. fact_key normalizes the fact text for dedupe (capped so the
-- generated column stays index-friendly); the writer treats a key conflict as
-- "already known" and skips. Facts die with their source item.
create table intel_facts (
  id           uuid primary key default gen_random_uuid(),
  company_slug text not null references intel_companies(slug) on delete cascade,
  dimension    text not null,
  fact         text not null,
  value_text   text,
  as_of        date,
  item_id      uuid references intel_items(id) on delete cascade,
  fact_key     text generated always as
    (left(lower(regexp_replace(fact, '[^a-zA-Z0-9]', '', 'g')), 120)) stored,
  created_at   timestamptz not null default now(),
  unique (company_slug, fact_key)
);

create index on intel_facts (company_slug, created_at desc);
alter table intel_facts enable row level security;

-- ------------------------------------------------------------- intel_metrics
-- LLM-free quarterly series from public structured APIs. Upsert-idempotent on
-- the natural key; `source` names the API so the same concept from two
-- sources never collides.
create table intel_metrics (
  id           uuid primary key default gen_random_uuid(),
  company_slug text not null references intel_companies(slug) on delete cascade,
  metric_code  text not null,
  period       date not null,
  value        numeric,
  unit         text,
  source       text not null check (source in ('edgar_xbrl', 'fdic', 'cfpb')),
  fetched_at   timestamptz not null default now(),
  unique (company_slug, metric_code, period, source)
);

create index on intel_metrics (company_slug, metric_code, period desc);
alter table intel_metrics enable row level security;

-- --------------------------------------------------------------- intel_prefs
-- Singleton (the scan_prefs pattern): enabled gates the CRON leg only (manual
-- console runs bypass); enrich_models is the A/B picker (empty = Haiku
-- baseline); utility_model overrides the synthesis default.
create table intel_prefs (
  id            boolean primary key default true check (id),
  enabled       boolean not null default true,
  enrich_models text[] not null default '{}',
  utility_model text,
  updated_at    timestamptz not null default now()
);
alter table intel_prefs enable row level security;
insert into intel_prefs (id) values (true) on conflict (id) do nothing;

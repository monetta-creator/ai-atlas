-- 0038_scan.sql — the External Scan (/scan): outside-the-firewall signal discovery.
-- A daily, cron-driven sweep across configurable news topics (broader than the AI
-- lenses): free RSS/Atom press feeds plus one web_search call per topic, full-text
-- hydration, and a light Haiku enrichment (summary, taxonomy tags, entities). The
-- day's items publish as the key-gated `external-scan` dataset for downstream
-- import into an external triage tool.
--
-- Boundaries this schema encodes:
--   * Topics are a registry table, not an enum (the scout_verticals precedent):
--     new topics and their query/feed templates are rows, not deploys. The REAL
--     topic set is seeded from private/scan-topics.json (untracked) by
--     scripts/seed-scan-topics.mjs; the seed below is a generic working example.
--   * scan_runs keys on `day` (one run per UTC day) and IS the checkpoint state:
--     the cron route and the console Resume both advance the same row, and the
--     lease column makes overlapping invocations harmless.
--   * scan_items dedupe: hard unique per (run_id, normalized_url), plus a
--     check-before-insert against the trailing window in the writer (a partial
--     unique index over "recent" is not expressible — now() is not immutable).
--   * Enrichment is advisory tagging only. No signal/claim wiring: the item's
--     judgment happens in the downstream tool, not here.

create type scan_step_t          as enum ('feeds', 'search', 'hydrate', 'enrich', 'complete');
create type scan_fetch_status_t  as enum ('pending', 'done', 'failed', 'skipped');
create type scan_enrich_status_t as enum ('pending', 'done', 'skipped', 'error');

-- ---------------------------------------------------------------- scan_topics
-- search_queries carry {year}/{month} tokens resolved per run window
-- (month-anchored, news-shaped: the discovery lesson). An empty search_queries
-- array makes a topic feeds-only — that array is the cost knob. `active` also
-- controls whether the topic's taxonomy_code is offered to enrichment tagging.
create table scan_topics (
  slug           text primary key,
  name           text not null,
  description    text,
  taxonomy_code  text not null,
  search_queries text[] not null default '{}',
  feed_urls      text[] not null default '{}',
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table scan_topics enable row level security;

insert into scan_topics (slug, name, description, taxonomy_code, search_queries, feed_urls) values
  ('central-bank-policy', 'Central bank policy',
   'Policy rate decisions, official communications, and market rate expectations.',
   'EX.1',
   array['central bank interest rate decision {month} {year}'],
   array['https://www.federalreserve.gov/feeds/press_all.xml']),
  ('securities-regulation', 'Securities regulation',
   'Securities regulator rulemaking, enforcement actions, and market-structure changes.',
   'EX.2',
   array['SEC rulemaking enforcement action {month} {year}'],
   array['https://www.sec.gov/news/pressreleases.rss'])
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- scan_runs
-- One row per UTC day; reuses run_status_t (0005). searched_topics is the
-- per-topic search checkpoint; lease_until is the overlap guard for the two
-- daily cron invocations (the second exits quietly while the first holds it).
create table scan_runs (
  id                uuid primary key default gen_random_uuid(),
  day               date not null unique,
  status            run_status_t not null default 'running',
  step              scan_step_t  not null default 'feeds',
  searched_topics   text[] not null default '{}',
  feed_item_count   int not null default 0,
  search_item_count int not null default 0,
  hydrated_count    int not null default 0,
  enriched_count    int not null default 0,
  skipped_count     int not null default 0,
  error             text,
  lease_until       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_scan_runs_updated
  before update on scan_runs
  for each row execute function set_updated_at();

create index on scan_runs (day desc);
alter table scan_runs enable row level security;

-- ---------------------------------------------------------------- scan_items
-- One discovered item. discovered_via is the discovering topic's slug for the
-- feed leg, or 'web_search' for the search leg (topic_slug carries the topic
-- either way). tags are taxonomy codes assigned by enrichment, allow-listed
-- against active scan_topics at write time.
create table scan_items (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references scan_runs(id) on delete cascade,
  topic_slug     text references scan_topics(slug),
  url            text not null,
  normalized_url text not null,
  headline       text,
  source_domain  text,
  published_date date,
  discovered_via text not null,
  raw_content    text,
  fetched_via    text,
  fetch_status   scan_fetch_status_t  not null default 'pending',
  fetch_error    text,
  enrich_status  scan_enrich_status_t not null default 'pending',
  summary        text,
  tags           text[] not null default '{}',
  entities       text[] not null default '{}',
  relevance      numeric(3,2),
  created_at     timestamptz not null default now(),
  unique (run_id, normalized_url)
);

create index scan_items_normurl_idx on scan_items (normalized_url, created_at desc);
create index on scan_items (run_id, fetch_status);
create index on scan_items (run_id, enrich_status);
alter table scan_items enable row level security;

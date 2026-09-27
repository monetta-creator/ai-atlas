-- 0076_history_and_self_record.sql (2026-09-27): the one-time backfill since
-- ChatGPT (2022-11-30) and the reader organization's public record.
--
-- Every live reader of the engine tables windows on created_at (the Daily
-- Edition, the intel deck, Savant's pack and spikes, the datasets by run day),
-- so the backfill never writes into them. It writes here instead, keyed on the
-- article's own publish date, with its checkpoint in backfill_units. See
-- docs/history-backfill.md and docs/self-record.md.
--
-- The reader organization is the intel registry's `self` tier. Its name never
-- appears in code or migrations; every source query is built from the row.

-- The checkpoint and audit for scripts/history-backfill.mts: one row per unit
-- of work (a month-lens search window, an SEC filing, a synthesis leg).
create table if not exists backfill_units (
  key        text primary key,
  phase      text not null,
  status     text not null default 'pending' check (status in ('pending', 'done', 'failed', 'skipped')),
  credits    int not null default 0,
  cost_usd   numeric(10, 5) not null default 0,
  items      int not null default 0,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists backfill_units_phase_idx on backfill_units (phase, status);
drop trigger if exists trg_backfill_units_updated on backfill_units;
create trigger trg_backfill_units_updated before update on backfill_units for each row execute function set_updated_at();
alter table backfill_units enable row level security;

-- The AI economy since ChatGPT: what the news search returned per month and
-- audience lens, triaged, with the month's landmarks drafted into signals.
create table if not exists history_items (
  id             uuid primary key default gen_random_uuid(),
  url            text not null,
  url_key        text not null unique,
  title          text not null,
  snippet        text,
  published_date date not null,
  window_month   date not null,
  lens           signal_lens_t not null,
  query          text,
  domain         text,
  source_tier    smallint,
  source_kind    text,
  triage         text not null default 'pending' check (triage in ('pending', 'kept', 'rejected', 'duplicate')),
  triage_reason  text,
  significance   text check (significance in ('high', 'medium', 'low')),
  landmark       boolean not null default false,
  raw_content    text,
  candidate_id   uuid references signal_candidates(id) on delete set null,
  signal_id      uuid references signals(id) on delete set null,
  batch          text not null default 'since-chatgpt',
  created_at     timestamptz not null default now()
);
create index if not exists history_items_month_idx on history_items (window_month, lens);
create index if not exists history_items_kept_idx on history_items (published_date) where triage = 'kept';
alter table history_items enable row level security;

-- The reader organization's public record since ChatGPT: filings, press
-- releases, news, papers, patents, regulatory documents. Documents and events
-- only; numbers stay in intel_metrics.
create table if not exists self_record (
  id             uuid primary key default gen_random_uuid(),
  company_slug   text not null references intel_companies(slug) on delete cascade,
  source         text not null check (source in (
                   'sec_filing', 'sec_exhibit', 'news', 'newsroom', 'paper', 'patent',
                   'enforcement', 'comment_letter', 'merger', 'testimony')),
  title          text not null,
  url            text not null unique,
  published_date date,
  summary        text,
  ai_related     boolean not null default false,
  ai_passages    text[] not null default '{}',
  text_excerpt   text,
  dimension      text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists self_record_company_idx on self_record (company_slug, published_date desc);
create index if not exists self_record_ai_idx on self_record (company_slug, published_date) where ai_related;
alter table self_record enable row level security;

-- The dated AI timeline synthesized from the record; every event cites at
-- least one self_record row (validated by the writer, since arrays carry no FK).
create table if not exists self_timeline (
  id           uuid primary key default gen_random_uuid(),
  company_slug text not null references intel_companies(slug) on delete cascade,
  event_date   date not null,
  category     text not null,
  headline     text not null,
  body         text,
  record_ids   uuid[] not null check (cardinality(record_ids) > 0),
  created_at   timestamptz not null default now()
);
create index if not exists self_timeline_company_idx on self_timeline (company_slug, event_date desc);
alter table self_timeline enable row level security;

-- The cited profile Savant reads in place of the one-line blurb:
-- {sentences: [{text, record_ids}], built_at, model}. Every sentence traces
-- to a public record; public_blurb stays the maintainer's own line.
alter table intel_companies add column if not exists public_profile jsonb;

-- history_item joins the embedded kinds (keyholders and admin in Ask).
alter table embeddings drop constraint if exists embeddings_kind_check;
alter table embeddings add constraint embeddings_kind_check check (kind in (
  'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
  'paper', 'claim', 'bridge', 'stance', 'concept', 'thread', 'report', 'history_item'));

-- 0034_scout.sql — Startup Scout (/scout): the acquisition-target funnel.
-- Young AI companies discovered per vertical, scored recommend-only against an
-- editable acquisition rubric, and human-reviewed into a tracked watchlist.
--
-- Boundaries this schema encodes:
--   * Companies follow the `papers` model (0023), not signal_candidates: the row
--     IS both library and funnel state, permanent, deduped GLOBALLY by domain
--     and normalized name. run_id is provenance only.
--   * The agent layer (verdict/scores/reason) is advisory and ADMIN-ONLY at
--     read time: a public "pursue" chip on a named startup would disclose M&A
--     intent. Guests see descriptive facts about tracked companies only.
--   * tracked == the watchlist; there is no separate flag. The HUMAN moves
--     status; agent stamps are kept after the decision (agreement-rate audit).
--   * Verticals are a registry table, not an enum: new verticals (and their
--     discovery query templates) are rows, not deploys.

create type company_status_t as enum ('queued', 'tracked', 'dismissed', 'archived');
create type company_stage_t  as enum ('pre_seed', 'seed', 'series_a', 'series_b', 'later', 'unknown');
create type scout_verdict_t  as enum ('pursue', 'watch', 'pass');
create type scout_step_t     as enum ('discovery', 'complete');
create type company_event_t  as enum ('funding', 'launch', 'news', 'milestone', 'note');
create type company_origin_t as enum ('discovery', 'manual');

-- ---------------------------------------------------------------- scout_verticals
-- The acquisition thesis's verticals. search_queries carry {year}/{month} tokens
-- resolved per run window (month-anchored, news-shaped: the discovery lesson).
create table scout_verticals (
  slug           text primary key,
  name           text not null,
  description    text,
  search_queries text[] not null default '{}',
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table scout_verticals enable row level security;

insert into scout_verticals (slug, name, description, search_queries) values
  ('fintech', 'Fintech',
   'AI applied to payments, banking, lending, underwriting, and fraud.',
   array[
     'AI fintech startup raises seed round {month} {year}',
     'AI fintech startup Series A funding {month} {year}',
     'new AI startup payments underwriting launch {month} {year}',
     'AI fraud detection startup funding {year}'
   ]),
  ('enterprise-workflows', 'Enterprise workflows',
   'AI agents and copilots for enterprise software and knowledge work.',
   array[
     'AI enterprise workflow startup seed funding {month} {year}',
     'AI agent startup enterprise software raises {month} {year}',
     'new AI copilot startup enterprise launch {month} {year}',
     'AI document automation startup funding {year}'
   ]),
  ('process-automation', 'Process automation',
   'AI-native automation of back-office and operational processes.',
   array[
     'AI process automation startup raises {month} {year}',
     'intelligent automation startup seed round {month} {year}',
     'AI back office automation startup launch {month} {year}',
     'AI startup replaces RPA funding {year}'
   ])
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- scout_runs
-- One row per manual discovery run; reuses run_status_t (the 0023 precedent).
-- Runs are console-driven and DB-checkpointed per vertical query batch.
create table scout_runs (
  id           uuid primary key default gen_random_uuid(),
  triggered_at timestamptz not null default now(),
  status       run_status_t not null default 'running',
  step         scout_step_t not null default 'discovery',
  found_count  int not null default 0,   -- companies the search returned
  new_count    int not null default 0,   -- actually inserted after global dedupe
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_scout_runs_updated
  before update on scout_runs
  for each row execute function set_updated_at();

create index on scout_runs (triggered_at desc);
alter table scout_runs enable row level security;

-- ---------------------------------------------------------------- companies
create table companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- dedupe identity: bare host when known, normalized name always
  domain       text,
  name_key     text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) stored,
  url          text,
  vertical     text not null references scout_verticals(slug),
  -- description (enrichment and the admin may fill; human edits win)
  one_liner    text,
  ai_tech      text,                     -- the AI tech itself: the acquisition object
  founded_year int,
  stage        company_stage_t not null default 'unknown',
  funding_note text,                     -- 'Seed, $8M, 2025, a16z' style; web data is imprecise
  hq           text,
  -- funnel state (tracked == the watchlist)
  status       company_status_t not null default 'queued',
  review_note  text,                     -- the human's why; admin-only at read time
  reviewed_at  timestamptz,
  -- agent stamps (recommend-only, kept after the decision; admin-only at read time)
  agent_verdict    scout_verdict_t,
  agent_reason     text,
  agent_confidence int check (agent_confidence between 0 and 100),
  agent_scores     jsonb,               -- {ai_depth, acquisition_fit, traction, team, integration_cost} 1-5
  agent_at         timestamptz,
  -- enrichment cache (homepage fetch + structured dossier)
  raw_content  text,
  fetched_via  text,                    -- 'direct' | 'jina'
  dossier      jsonb,
  -- provenance
  origin       company_origin_t not null default 'discovery',
  run_id       uuid references scout_runs(id) on delete set null,
  found_url    text,                    -- the article discovery saw the company in
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_companies_updated
  before update on companies
  for each row execute function set_updated_at();

create unique index companies_domain_uq on companies (domain) where domain is not null;
create index on companies (name_key);
create index on companies (status, vertical);
create index on companies (run_id);
alter table companies enable row level security;

-- ---------------------------------------------------------------- company_events
-- The per-company timeline: funding rounds, launches, notable news, admin notes.
-- signal_id is future wiring (a company event promoted from/linked to a signal).
create table company_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  event_date date not null default now(),
  kind       company_event_t not null default 'news',
  title      text not null,
  url        text,
  note       text,
  signal_id  uuid references signals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on company_events (company_id, event_date desc);
alter table company_events enable row level security;

-- ---------------------------------------------------------------- scout_prefs
-- Steering + rubric singleton, mirroring research_agent_prefs (0033). rubric
-- null means the code's DEFAULT_RUBRIC applies; the row lets the admin edit the
-- acquisition rubric without a deploy.
create table scout_prefs (
  id         boolean primary key default true check (id),
  steering   text,
  rubric     text,
  updated_at timestamptz not null default now()
);
alter table scout_prefs enable row level security;

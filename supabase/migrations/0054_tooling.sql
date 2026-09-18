-- 0054_tooling.sql — the AI Tooling Monitor (/tooling): an eighth portal that
-- scans the AI tool market weekly, catalogs products on a curated category
-- registry plus emergent feature tags, deep-dives high-fit entrants, and
-- backs four kinds of generated report (category landscape, build-vs-buy
-- brief, weekly new entrants, feature-steal sheet).
--
-- Boundaries this schema encodes:
--   * Not a Scout extension: products carry catalog semantics (curated
--     categories, feature tags, dossier + deep dive, feed polling), not
--     Scout's M&A semantics (funding stage, pursue/watch/pass, a youth
--     screen). Own tables; the pure helpers (name/url key, dossier merge,
--     event dedupe) are copied and adapted in lib/tooling/core.ts.
--   * tooling_categories is a registry table (the scan_topics precedent):
--     rows, not deploys. The REAL category list is seeded from
--     private/tooling-categories.json (untracked) by scripts/seed-tooling.mjs;
--     the seed below is a generic starter set the public repo runs on
--     standalone.
--   * tooling_runs keys on (kind, day) and IS the checkpoint state (the
--     scan_runs / intel_runs pattern): swept_units holds per-unit checkpoints
--     ('cat:<slug>', 'ph', 'enum:<slug>:leaders', 'dd:<id>', 'report'),
--     lease_until guards overlapping invocations, notes[] persists per-run
--     issues. kind distinguishes the weekly cadence run (day = the Monday
--     UTC) from the one-time big pull (day = its start day).
--   * tooling_products IS both library and funnel state (the companies/papers
--     model): permanent rows, deduped globally by url_key first, else
--     name_key + vendor_domain (lib/tooling/core.ts matchExisting). Human
--     curation (status/pinned/review_note) is sticky: the agent auto-catalogs
--     above a fit threshold but never re-labels a human decision.
--   * The agent layer (agent_fit/agent_scores/agent_reason) is recommend-only
--     and readable by portal keyholders and admins, never guests (a public
--     fit score on a named vendor is an opinion the Atlas should not publish
--     unattended); lib/data/tooling.ts enforces it with column lists.
--   * search_tsv needs array_to_string(text[]) inside a generated column;
--     that function is only STABLE in Postgres (the 0037 lesson), so
--     tooling_array_text wraps it IMMUTABLE.
--   * report_kind_t gains four values for a later work package's report
--     library; nothing in THIS file inserts a row carrying one of them
--     (Postgres allows ADD VALUE inside this migration's transaction but
--     forbids USING the new value in the same transaction).

create type tooling_status_t   as enum ('candidate', 'cataloged', 'parked', 'dismissed');
create type tooling_maturity_t as enum
  ('startup_early', 'startup_growth', 'scaleup', 'incumbent', 'big_tech', 'open_source_project', 'unknown');
create type tooling_origin_t   as enum ('tavily', 'hn', 'producthunt', 'github', 'enumeration', 'manual', 'feed');
create type tooling_event_t    as enum
  ('launch', 'funding', 'feature', 'pricing', 'partnership', 'news', 'changelog', 'note');
create type tooling_step_t     as enum
  ('discover', 'hydrate', 'enrich', 'score', 'finish', 'events', 'deepdive', 'report', 'complete');
create type tooling_run_kind_t as enum ('weekly', 'pull');

alter type report_kind_t add value if not exists 'tooling_landscape';
alter type report_kind_t add value if not exists 'tooling_brief';
alter type report_kind_t add value if not exists 'tooling_entrants';
alter type report_kind_t add value if not exists 'tooling_features';

-- array_to_string(anyarray, text) is only STABLE, so a generated column can't
-- call it directly (the 0037 lesson); this wrapper is IMMUTABLE because its
-- output depends only on its text[] input.
create or replace function tooling_array_text(arr text[])
returns text
language sql immutable as
$$ select coalesce(array_to_string(arr, ' '), '') $$;

-- ------------------------------------------------------------ tooling_categories
-- The curated, editable category registry. search_queries carry {year}/{month}
-- tokens (weekly discovery, news-shaped); pull_queries are evergreen (the
-- one-time enumeration pass). hn_query/github_query are short keyword strings,
-- not full queries. Query columns are admin-only at read time (guests get
-- '{}' / null — lib/data/tooling.ts getToolingCategories).
create table tooling_categories (
  slug           text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  name           text not null,
  description    text,
  search_queries text[] not null default '{}',
  pull_queries   text[] not null default '{}',
  hn_query       text,
  github_query   text,
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_tooling_categories_updated
  before update on tooling_categories
  for each row execute function set_updated_at();

alter table tooling_categories enable row level security;

insert into tooling_categories
  (slug, name, description, search_queries, pull_queries, hn_query, github_query, sort_order) values
  ('coding-assistants', 'Coding assistants',
   'AI-assisted software development: code completion, generation, review, and refactoring tools.',
   array['new AI coding assistant launch {month} {year}', 'AI code review tool funding {month} {year}'],
   array['best AI coding assistants for enterprise teams', 'top AI pair programming tools compared'],
   'AI coding assistant', 'AI coding assistant', 10),
  ('agent-platforms', 'Agent platforms',
   'Frameworks and platforms for building, orchestrating, and deploying autonomous AI agents.',
   array['new AI agent platform launch {month} {year}', 'AI agent orchestration startup funding {month} {year}'],
   array['best AI agent platforms for enterprise', 'top AI agent orchestration frameworks compared'],
   'AI agent framework', 'AI agent framework', 20),
  ('enterprise-search-rag', 'Enterprise search and RAG',
   'Enterprise search and retrieval-augmented generation over internal knowledge and documents.',
   array['new enterprise AI search launch {month} {year}', 'retrieval augmented generation startup funding {month} {year}'],
   array['best enterprise RAG platforms for large companies', 'top AI enterprise search tools compared'],
   'enterprise RAG search', 'retrieval augmented generation', 30),
  ('document-intelligence', 'Document intelligence',
   'AI extraction, classification, and understanding of unstructured documents.',
   array['new document intelligence AI launch {month} {year}', 'AI document processing startup funding {month} {year}'],
   array['best AI document intelligence platforms for enterprise', 'top intelligent document processing tools compared'],
   'document intelligence AI', 'document extraction AI', 40),
  ('model-gateways-llmops', 'Model gateways and LLMOps',
   'Gateways, routers, and operations tooling for deploying and managing LLMs in production.',
   array['new LLM gateway platform launch {month} {year}', 'LLMOps startup funding {month} {year}'],
   array['best LLM gateway and routing platforms for enterprise', 'top LLMOps platforms compared'],
   'LLM gateway LLMOps', 'LLM gateway router', 50),
  ('evals-observability', 'Evals and observability',
   'Evaluation, monitoring, and observability tooling for AI model and application quality.',
   array['new AI evaluation observability tool launch {month} {year}', 'LLM evals startup funding {month} {year}'],
   array['best AI model evaluation platforms for enterprise', 'top LLM observability tools compared'],
   'LLM eval observability', 'LLM evaluation observability', 60),
  ('guardrails-security', 'Guardrails and security',
   'Guardrails, red-teaming, and security tooling for LLM applications.',
   array['new AI guardrails security tool launch {month} {year}', 'LLM security startup funding {month} {year}'],
   array['best AI guardrail platforms for enterprise', 'top LLM security and red teaming tools compared'],
   'LLM guardrails security', 'LLM guardrails security', 70),
  ('contact-center-ai', 'Contact center AI',
   'AI for customer service and contact centers: voice and chat agents, QA, and routing.',
   array['new AI contact center platform launch {month} {year}', 'AI customer service startup funding {month} {year}'],
   array['best AI contact center platforms for enterprise', 'top AI customer service automation tools compared'],
   'AI contact center', 'AI customer service bot', 80),
  ('workflow-automation', 'Workflow automation',
   'AI-native automation of business processes and cross-application workflows.',
   array['new AI workflow automation tool launch {month} {year}', 'AI process automation startup funding {month} {year}'],
   array['best AI workflow automation platforms for enterprise', 'top AI business process automation tools compared'],
   'AI workflow automation', 'AI workflow automation', 90),
  ('data-labeling-synthetic', 'Data labeling and synthetic data',
   'Data labeling, annotation, and synthetic data generation for training AI models.',
   array['new AI data labeling platform launch {month} {year}', 'synthetic data startup funding {month} {year}'],
   array['best AI data labeling platforms for enterprise', 'top synthetic data generation tools compared'],
   'synthetic data labeling', 'synthetic data generation', 100),
  ('voice-agents', 'Voice agents',
   'Conversational voice AI: telephony agents, transcription, and voice interfaces.',
   array['new AI voice agent launch {month} {year}', 'voice AI startup funding {month} {year}'],
   array['best AI voice agent platforms for enterprise', 'top conversational voice AI tools compared'],
   'AI voice agent', 'voice AI agent', 110),
  ('meeting-productivity-copilots', 'Meeting and productivity copilots',
   'AI copilots for meetings, notes, scheduling, and everyday knowledge-work productivity.',
   array['new AI meeting copilot launch {month} {year}', 'AI productivity copilot startup funding {month} {year}'],
   array['best AI meeting assistant tools for enterprise', 'top AI productivity copilots compared'],
   'AI meeting copilot', 'AI meeting assistant', 120),
  ('analytics-copilots', 'Analytics copilots',
   'AI copilots for data analysis, business intelligence, and natural language querying of data.',
   array['new AI analytics copilot launch {month} {year}', 'AI business intelligence copilot startup funding {month} {year}'],
   array['best AI analytics copilots for enterprise', 'top natural language BI tools compared'],
   'AI analytics copilot', 'AI data analytics copilot', 130),
  ('fin-services-vertical', 'Financial services vertical AI',
   'AI products built specifically for banking, payments, and financial services workflows.',
   array['new AI financial services product launch {month} {year}', 'AI fintech vertical startup funding {month} {year}'],
   array['best AI tools for financial services compliance and operations', 'top vertical AI platforms for banking compared'],
   'AI financial services', 'AI fintech platform', 140),
  ('legal-compliance-ai', 'Legal and compliance AI',
   'AI for legal research, contract review, and regulatory compliance work.',
   array['new AI legal compliance tool launch {month} {year}', 'legal AI startup funding {month} {year}'],
   array['best AI contract review platforms for enterprise', 'top AI legal research tools compared'],
   'AI legal compliance', 'AI legal contract review', 150),
  ('sales-marketing-ai', 'Sales and marketing AI',
   'AI for sales enablement, marketing content, and go-to-market workflows.',
   array['new AI sales marketing tool launch {month} {year}', 'AI sales enablement startup funding {month} {year}'],
   array['best AI sales enablement platforms for enterprise', 'top AI marketing content tools compared'],
   'AI sales marketing', 'AI sales enablement', 160)
on conflict (slug) do nothing;

-- ------------------------------------------------------------------ tooling_runs
-- One row per (kind, day); reuses run_status_t (0005). A weekly run's day is
-- the Monday UTC of its week (lib/tooling/core.ts weekKey); a pull run's day
-- is its start day. swept_units is the per-unit checkpoint array
-- ('cat:<slug>', 'ph', 'enum:<slug>:leaders', 'dd:<id>', 'report');
-- lease_until is the overlap guard; notes[] the persisted issue log.
create table tooling_runs (
  id               uuid primary key default gen_random_uuid(),
  kind             tooling_run_kind_t not null,
  day              date not null,
  status           run_status_t not null default 'running',
  step             tooling_step_t not null default 'discover',
  swept_units      text[] not null default '{}',
  found_count      int not null default 0,
  inserted_count   int not null default 0,
  hydrated_count   int not null default 0,
  enriched_count   int not null default 0,
  scored_count     int not null default 0,
  cataloged_count  int not null default 0,
  deep_dived_count int not null default 0,
  event_count      int not null default 0,
  report_id        uuid references generated_reports(id) on delete set null,
  error            text,
  lease_until      timestamptz,
  notes            text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (kind, day)
);

create trigger trg_tooling_runs_updated
  before update on tooling_runs
  for each row execute function set_updated_at();

create index on tooling_runs (day desc);
alter table tooling_runs enable row level security;

-- --------------------------------------------------------------- tooling_products
-- Both library and funnel state, permanent (the companies/papers model).
-- name_key mirrors companies.name_key exactly (lib/tooling/core.ts
-- productNameKey); url_key is writer-set (lib/tooling/core.ts productUrlKey:
-- host without www + path, no query, no trailing slash) and unique where not
-- null, so a product with no known homepage never collides on url_key. The
-- dedupe rule (lib/tooling/core.ts matchExisting, applied by
-- insertProducts): url_key match first, else name_key AND (vendor_domain
-- equal or either null). status/pinned/review_note are the human curation
-- layer and are STICKY: the scoring agent never demotes a cataloged product
-- and never touches a pinned one.
create table tooling_products (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  name_key             text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) stored,
  slug                 text not null unique,
  vendor               text,
  vendor_domain        text,
  url                  text,
  url_key              text,
  category             text not null references tooling_categories(slug) on delete restrict,
  secondary_categories text[] not null default '{}',
  one_liner            text,
  description          text,
  target_buyer         text[] not null default '{}',
  deployment           text[] not null default '{}',
  pricing_model        text,
  pricing_note         text,
  maturity             tooling_maturity_t not null default 'unknown',
  founded_year         int,
  hq                   text,
  funding_note         text,
  notable_customers    text[] not null default '{}',
  integrations         text[] not null default '{}',
  compliance_claims    text[] not null default '{}',
  models_used          text[] not null default '{}',
  features             text[] not null default '{}',
  feed_url             text,
  changelog_url        text,
  github_repo          text,
  feed_checked_at      timestamptz,
  -- curation (human, sticky)
  status               tooling_status_t not null default 'candidate',
  pinned               boolean not null default false,
  review_note          text,
  reviewed_at          timestamptz,
  -- agent (recommend-only)
  agent_fit            int check (agent_fit between 0 and 100),
  agent_scores         jsonb,
  agent_reason         text,
  agent_model          text,
  agent_at             timestamptz,
  -- fetch cache
  raw_content          text,
  fetched_via          text,
  fetched_at           timestamptz,
  fetch_error          text,
  -- enrichment
  enriched_at          timestamptz,
  enriched_by          text,
  dossier              jsonb,
  deep_dive            jsonb,
  deep_dived_at        timestamptz,
  -- provenance
  origin               tooling_origin_t not null default 'manual',
  found_url            text,
  found_title          text,
  run_id               uuid references tooling_runs(id) on delete set null,
  first_seen           date not null default current_date,
  last_seen            date not null default current_date,
  search_tsv           tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(vendor, '') || ' ' || coalesce(one_liner, '')), 'B') ||
    setweight(to_tsvector('english',
      coalesce(description, '') || ' ' || tooling_array_text(features) || ' ' || coalesce(category, '')), 'C')
  ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_tooling_products_updated
  before update on tooling_products
  for each row execute function set_updated_at();

create unique index tooling_products_url_key_uq on tooling_products (url_key) where url_key is not null;
create index on tooling_products (name_key);
create index on tooling_products (status, category);
create index on tooling_products (status, first_seen desc);
create index on tooling_products (run_id);
create index tooling_products_search_idx on tooling_products using gin (search_tsv)
  where status in ('cataloged', 'parked');

alter table tooling_products enable row level security;

-- ---------------------------------------------------------------- tooling_events
-- The per-product timeline: launches, funding, feature/pricing changes,
-- partnerships, feed-discovered changelog entries, and admin notes. note is
-- working provenance only (never exported); source names the writer that
-- logged the event ('feed' | 'discover' | 'deepdive' | 'manual').
create table tooling_events (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references tooling_products(id) on delete cascade,
  event_date date not null default current_date,
  kind       tooling_event_t not null default 'news',
  title      text not null,
  url        text,
  note       text,
  source     text not null check (source in ('feed', 'deepdive', 'discover', 'manual')),
  created_at timestamptz not null default now()
);

create index on tooling_events (product_id, event_date desc);
alter table tooling_events enable row level security;

-- ---------------------------------------------------------------- tooling_prefs
-- Singleton (the scan_prefs / intel_prefs pattern). enabled gates the CRON
-- leg only (manual console runs bypass); utility_model/enrich_model null mean
-- the code defaults (lib/data/tooling.ts getToolingPrefs resolves them).
-- auto_publish_entrants defaults TRUE (the weekly entrants report is the
-- second auto-publishing report kind after the roundup, Kevin's explicit
-- call); the build-vs-buy brief never auto-publishes regardless of this pref.
create table tooling_prefs (
  id                    boolean primary key default true check (id),
  enabled               boolean not null default true,
  steering              text,
  rubric                text,
  utility_model         text,
  enrich_model          text,
  catalog_threshold     int not null default 60 check (catalog_threshold between 0 and 100),
  deep_dive_threshold   int not null default 75 check (deep_dive_threshold between 0 and 100),
  deep_dive_cap         int not null default 15 check (deep_dive_cap between 0 and 50),
  auto_publish_entrants boolean not null default true,
  updated_at            timestamptz not null default now()
);
alter table tooling_prefs enable row level security;
insert into tooling_prefs (id) values (true) on conflict (id) do nothing;

-- Source discovery pipeline: discover -> triage -> analyze -> (human) review.
-- Staging tables that hold work-in-progress before a candidate becomes a draft signal.
-- The pipeline runs as many short, DB-checkpointed steps (Hobby 60s cap); these tables
-- ARE the checkpoint state, which also makes runs resumable and the logic cron-portable.

create type triage_status_t as enum ('pending', 'approved', 'rejected', 'duplicate');
create type run_cadence_t    as enum ('manual', 'daily', 'weekly');
create type run_status_t     as enum ('running', 'completed', 'failed');
create type run_step_t       as enum ('discovery', 'triage', 'analysis', 'complete');
create type signal_origin_t  as enum ('manual', 'pipeline');

-- Mark how a signal was created, so the Signal Board admin view can badge
-- pipeline-generated drafts. Existing rows backfill to 'manual'.
alter table signals add column origin signal_origin_t not null default 'manual';

-- ---------------------------------------------------------------- pipeline_runs
-- One row per pipeline run; tracks which step is live and the running tallies the
-- admin UI polls. No triggered_by — the app has a single boolean admin, no per-user id.
create table pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  triggered_at    timestamptz not null default now(),
  cadence         run_cadence_t not null default 'manual',
  status          run_status_t  not null default 'running',
  step            run_step_t    not null default 'discovery',
  candidate_count int  not null default 0,
  approved_count  int  not null default 0,
  signal_count    int  not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_pipeline_runs_updated
  before update on pipeline_runs
  for each row execute function set_updated_at();

create index on pipeline_runs (triggered_at desc);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table pipeline_runs enable row level security;

-- ---------------------------------------------------------------- signal_candidates
-- Everything retrieved in discovery, before it earns its way to a draft signal.
-- `lens` reuses the Signal Board's signal_lens_t (the lens it was retrieved under).
-- raw_content is filled at analysis; signal_id is set when a candidate becomes a draft.
create table signal_candidates (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references pipeline_runs(id) on delete cascade,
  url           text not null,
  headline      text,
  source_domain text,
  lens          signal_lens_t not null,
  published_date date,
  retrieved_at  timestamptz not null default now(),
  triage_status triage_status_t not null default 'pending',
  triage_reason text,                                   -- model-written, human-readable
  signal_id     uuid references signals(id) on delete set null,
  raw_content   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (run_id, url)                                  -- dedup within a run; safe re-runs
);

create trigger trg_signal_candidates_updated
  before update on signal_candidates
  for each row execute function set_updated_at();

create index on signal_candidates (run_id, triage_status);
create index on signal_candidates (signal_id);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table signal_candidates enable row level security;

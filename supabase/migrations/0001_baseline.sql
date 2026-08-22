-- 0001_baseline.sql — The Strategy Atlas schema (squashed baseline, transition D-010).
--
-- One tier of belief-objects (D-016): HYPOTHESES carry the falsifiable test and the
-- gated CONVICTION (D-017); EVIDENCE attaches directly to a hypothesis with a
-- per-link CONFIDENCE (low/medium/high), direction, and why-it-bears note; SIGNALS
-- are tracked developments with INTERNAL/EXTERNAL context whose findings enter the
-- record only when a human publishes (syncSignalEvidence). The model proposes, the
-- human commits: conviction never moves without a rationale, and every move writes
-- a snapshot.
--
-- RLS is enabled with no public policies on every table (deny-by-default; the
-- app's DB role bypasses — all access is server-mediated).

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- enums
create type resolvability_t     as enum ('clean','slow','qualitative');
create type direction_t         as enum ('supports','contradicts','neutral');
create type weight_t            as enum ('high','medium','low');
create type trigger_t           as enum ('scheduled','manual','post_commit');
create type hypothesis_status_t as enum ('active','retired','resolved');
create type significance_t      as enum ('high','medium','low');
create type context_t           as enum ('internal','external');
create type signal_origin_t     as enum ('manual','pipeline');
create type triage_status_t     as enum ('pending','approved','rejected','duplicate');
create type run_cadence_t       as enum ('manual','source');
create type run_status_t        as enum ('running','completed','failed');
create type run_step_t          as enum ('triage','analysis','complete');
create type analysis_status_t   as enum ('pending','drafted','error','discarded');
create type concept_status_t    as enum ('settled','contested');
create type concept_link_status_t as enum ('suggested','confirmed');
create type paper_triage_t      as enum ('pending','kept','rejected');
create type paper_review_t      as enum ('pending','noted','tracked','dismissed');
create type thread_status_t     as enum ('open','settled','dormant');
create type thread_relation_t   as enum ('supports','complicates','contradicts','context');
create type report_kind_t       as enum ('hypothesis','atlas');
create type ticket_kind_t       as enum ('bug','feature');
create type ticket_status_t     as enum ('open','in_progress','resolved','declined');

-- ---------------------------------------------------------------- helpers
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- Conviction stored as a number, displayed as a word (thresholds carried over
-- from the AI Atlas; the words may be re-picked at UI-copy time, D-017).
create or replace function conf_label(c numeric) returns text as $$
  select case
    when c is null     then null
    when c < 0.40      then 'thin'
    when c < 0.60      then 'contested'
    when c < 0.80      then 'leaning'
    else                    'settled'
  end;
$$ language sql immutable;

-- array_to_string is only STABLE; this wrapper is IMMUTABLE-safe (output depends
-- only on its inputs) so generated columns can index a signal's touches.
create or replace function atlas_touch_text(touches text[], details jsonb)
returns text
language sql immutable as
$$ select coalesce(array_to_string(touches, ' '), '') || ' ' || coalesce(details::text, '') $$;

-- ---------------------------------------------------------------- hypotheses
-- The top-line unit: a strategic statement under test. Flat (no grouping tier,
-- D-013); a load-bearing sub-statement is promoted to its own hypothesis and
-- related via hypothesis_links (D-016). Conviction moves ONLY through the gate.
create table hypotheses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- stable short code: H1, H2, ... (citations, touches)
  statement     text not null,                 -- what we believe / are testing
  test          text not null,                 -- what evidence would move it (falsifiability)
  note          text,                          -- context: where it came from, scope, caveats
  resolvability resolvability_t,
  conviction    numeric(3,2) not null default 0.50
                check (conviction >= 0 and conviction <= 1),
  conviction_label text generated always as (conf_label(conviction)) stored,
  status        hypothesis_status_t not null default 'active',
  gap_scan      jsonb,                         -- the per-hypothesis gap diagnosis (recommend-only)
  search_tsv    tsvector generated always as (to_tsvector('english',
                  coalesce(statement,'') || ' ' || coalesce(test,'') || ' ' || coalesce(note,''))) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index hypotheses_status_idx on hypotheses (status, created_at);
create index hypotheses_search_idx on hypotheses using gin (search_tsv);
create index hypotheses_code_trgm  on hypotheses using gin (code gin_trgm_ops);

-- Promote-and-link: a related/narrower hypothesis, no tree, no second node type.
create table hypothesis_links (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references hypotheses(id) on delete cascade,
  to_id      uuid not null references hypotheses(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  unique (from_id, to_id),
  constraint hypothesis_links_no_self check (from_id <> to_id)
);
create index hypothesis_links_from_idx on hypothesis_links (from_id);
create index hypothesis_links_to_idx   on hypothesis_links (to_id);

-- ---------------------------------------------------------------- sources
-- An ingested artifact: document, memo, article, note. Text is retained at
-- intake (raw_text) and FTS-indexed; the file itself is not stored in v0 (OQ-5).
create table sources (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  author      text,
  outlet      text,                            -- publication / team / provenance label
  url         text,
  published_at date,
  storage_path text,                           -- reserved (OQ-5: storing originals)
  raw_text    text,
  reliability_prior int check (reliability_prior is null or (reliability_prior between 0 and 100)), -- operator-set only
  dossier     jsonb,                           -- structured AI dossier (audit trail for the prior)
  search_tsv  tsvector generated always as (to_tsvector('english',
                coalesce(title,'') || ' ' || left(coalesce(raw_text,''), 200000))) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sources_search_idx on sources using gin (search_tsv);

-- ---------------------------------------------------------------- signals
-- A tracked development, published by a human. context: INTERNAL (from inside
-- the walls) vs EXTERNAL (the outside world, e.g. the librarian's pulls).
-- touches holds hypothesis codes on the row (resolved at read time, GIN-indexed
-- for the reverse query); touch_details is the per-touch {direction, reason}
-- the admin reviews and that materializes into evidence ON PUBLISH.
create table signals (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  summary       text,
  significance  significance_t not null default 'medium',
  context       context_t not null default 'external',
  touches       text[] not null default '{}',
  touch_details jsonb not null default '{}'::jsonb,
  source_id     uuid references sources(id) on delete set null,  -- soft ref: deleting a source keeps the signal
  published_at  timestamptz not null default now(),              -- editorial date (ordering, digest range)
  is_published  boolean not null default false,                  -- the visibility gate
  origin        signal_origin_t not null default 'manual',
  archived_at   timestamptz,
  brief         jsonb,                          -- deep-dive analysis (what happened / why it matters / contested)
  counterpoint  jsonb,                          -- the other read
  search_tsv    tsvector generated always as (to_tsvector('english',
                  coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
                  coalesce(brief->>'what_happened','') || ' ' || coalesce(brief->>'why_it_matters','') || ' ' ||
                  coalesce(brief->>'whats_contested','') || ' ' ||
                  coalesce(counterpoint->>'the_other_read','') || ' ' ||
                  atlas_touch_text(touches, touch_details))) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index signals_published_idx    on signals (published_at desc);
create index signals_pub_gate_idx     on signals (is_published, published_at desc);
create index signals_touches_idx      on signals using gin (touches);
create index signals_archived_idx     on signals (archived_at) where archived_at is not null;
create index signals_search_idx       on signals using gin (search_tsv);

-- ---------------------------------------------------------------- evidence
-- The canonical hypothesis<->finding link. Provenance is a source (manual
-- attach) and/or a signal (materialized on publish; dies with its signal).
-- confidence is the operator's weight on THIS item bearing on THIS hypothesis
-- (D-017); direction says which way it cuts; note says why it bears.
create table evidence (
  id            uuid primary key default gen_random_uuid(),
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  source_id     uuid references sources(id) on delete cascade,
  signal_id     uuid references signals(id) on delete cascade,
  direction     direction_t not null,
  confidence    weight_t not null default 'medium',
  excerpt       text,
  note          text,
  actor         text not null default 'operator',   -- multi-user hedge (D-012)
  search_tsv    tsvector generated always as (to_tsvector('english',
                  coalesce(excerpt,'') || ' ' || coalesce(note,''))) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint evidence_provenance_chk check (source_id is not null or signal_id is not null)
);

create index evidence_hypothesis_idx on evidence (hypothesis_id);
create index evidence_source_idx     on evidence (source_id);
create index evidence_signal_idx     on evidence (signal_id);
create index evidence_search_idx     on evidence using gin (search_tsv);
create unique index evidence_signal_target_uniq
  on evidence (signal_id, hypothesis_id)
  where signal_id is not null;

-- ---------------------------------------------------------------- snapshots
-- Auto-written (post_commit) inside every conviction move; read by /calibration.
create table snapshots (
  id         uuid primary key default gen_random_uuid(),
  taken_at   timestamptz not null default now(),
  state      jsonb not null,                   -- { hypotheses: { id: conviction } }
  trigger    trigger_t not null default 'manual',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- rationales
-- Append-only audit of conviction moves: conviction can never move without its why.
create table rationales (
  id             uuid primary key default gen_random_uuid(),
  hypothesis_id  uuid not null references hypotheses(id) on delete cascade,
  old_conviction numeric(3,2),
  new_conviction numeric(3,2),
  reason         text not null,
  evidence_id    uuid references evidence(id) on delete set null,
  actor          text not null default 'operator',
  created_at     timestamptz not null default now()
);
create index rationales_hypothesis_idx on rationales (hypothesis_id);

-- ---------------------------------------------------------------- content_blocks
-- Per-key text overrides for About/landing copy; a missing key falls back to code.
create table content_blocks (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- digest audit
create table digest_snapshots (
  id              uuid primary key default gen_random_uuid(),
  sent_at         timestamptz not null default now(),
  recipient_email text,
  filter_params   jsonb,
  signal_ids      uuid[] not null default '{}',
  delivery_status text,
  created_at      timestamptz not null default now()
);
create index digest_snapshots_sent_idx on digest_snapshots (sent_at desc);

-- ---------------------------------------------------------------- intake pipeline
-- Candidates enter through manual/document intake with text retained up front;
-- triage -> analysis -> draft signal -> human publishes. These tables ARE the
-- checkpoint state, so runs are resumable.
create table pipeline_runs (
  id              uuid primary key default gen_random_uuid(),
  triggered_at    timestamptz not null default now(),
  cadence         run_cadence_t not null default 'manual',   -- 'source' = one manual upload
  status          run_status_t  not null default 'running',
  step            run_step_t    not null default 'triage',
  candidate_count int  not null default 0,
  approved_count  int  not null default 0,
  signal_count    int  not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index pipeline_runs_time_idx on pipeline_runs (triggered_at desc);

create table signal_candidates (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references pipeline_runs(id) on delete cascade,
  url             text not null,
  headline        text,
  source_domain   text,
  context         context_t not null default 'external',
  published_date  date,
  retrieved_at    timestamptz not null default now(),
  triage_status   triage_status_t not null default 'pending',
  triage_reason   text,
  signal_id       uuid references signals(id) on delete set null,
  source_id       uuid references sources(id) on delete set null,  -- manual upload: reuse the curated source
  raw_content     text,
  analysis_status analysis_status_t not null default 'pending',
  analysis_error  text,
  archived_at     timestamptz,
  search_tsv      tsvector generated always as (to_tsvector('english',
                    coalesce(headline,'') || ' ' || left(coalesce(raw_content,''), 200000))) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (run_id, url)
);
create index signal_candidates_run_idx      on signal_candidates (run_id, triage_status);
create index signal_candidates_signal_idx   on signal_candidates (signal_id);
create index signal_candidates_source_idx   on signal_candidates (source_id);
create index signal_candidates_archived_idx on signal_candidates (archived_at) where archived_at is not null;
create index signal_candidates_search_idx   on signal_candidates using gin (search_tsv) where signal_id is not null;

-- Draft-dedupe scan persistence (singleton; recommend-only, reconciled on read).
create table dedupe_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint dedupe_scan_singleton check (id)
);

-- ---------------------------------------------------------------- reports
-- Period reports: the saved generator output (admin-edited narrative + data).
create table reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled report',
  date_from    date not null,
  date_to      date not null,
  contexts     context_t[] not null default '{}',
  generated_at timestamptz not null,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index reports_updated_idx on reports (updated_at desc);

-- Generated tear sheets: per-hypothesis deep report + the whole-Atlas briefing.
-- Insert-only; is_published is the human gate onto the public shelf.
create table generated_reports (
  id           uuid primary key default gen_random_uuid(),
  kind         report_kind_t not null,
  subject      text,                    -- hypothesis code; null for 'atlas'
  title        text not null default 'Untitled report',
  scope_from   date,
  scope_to     date,
  pack         jsonb not null,          -- deterministic, guest-safe evidence pack + stats
  narrative    jsonb not null,          -- sanitized, citation-gated HTML sections + audit
  is_published boolean not null default false,
  generated_at timestamptz not null,
  created_at   timestamptz not null default now()
);
create index generated_reports_kind_idx on generated_reports (kind, generated_at desc);
create index generated_reports_pub_idx  on generated_reports (is_published, generated_at desc);

-- Frozen per-hypothesis runs (statement frozen at generation; guest-safe pack;
-- cited narrative). Immutable rows: a re-run inserts a new row.
create table hypothesis_reports (
  id            uuid primary key default gen_random_uuid(),
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  title         text not null default 'Untitled report',
  statement     text not null,
  pack          jsonb not null,
  narrative     jsonb not null,
  signal_ids    uuid[] not null default '{}',
  generated_at  timestamptz not null,
  created_at    timestamptz not null default now()
);
create index hypothesis_reports_hyp_idx on hypothesis_reports (hypothesis_id, generated_at desc);

-- ---------------------------------------------------------------- AI cost meter
create table ai_rate_cards (
  id                   uuid primary key default gen_random_uuid(),
  model                text not null,
  effective_date       date not null,
  input_per_mtok       numeric(10,4) not null,
  output_per_mtok      numeric(10,4) not null,
  cache_write_per_mtok numeric(10,4) not null,
  cache_read_per_mtok  numeric(10,4) not null,
  context_window       integer not null,
  created_at           timestamptz not null default now(),
  unique (model, effective_date)
);
create index ai_rate_cards_model_date_idx on ai_rate_cards (model, effective_date desc);

create table ai_cost_log (
  id                  uuid primary key default gen_random_uuid(),
  feature             text not null,
  model               text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  wall_ms             integer not null default 0,
  context_pct         numeric(5,2),
  cost_usd            numeric(12,6) not null default 0,   -- frozen at write time
  rate_card_id        uuid references ai_rate_cards(id) on delete set null,
  pipeline_run_id     uuid references pipeline_runs(id) on delete set null,
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now()
);
create index ai_cost_log_created_idx on ai_cost_log (created_at desc);
create index ai_cost_log_feature_idx on ai_cost_log (feature);
create index ai_cost_log_run_idx     on ai_cost_log (pipeline_run_id) where pipeline_run_id is not null;

-- Rate cards for the models the app calls (USD per 1M tokens; append-only —
-- a price change is a NEW row with a later effective_date).
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('claude-sonnet-4-6', date '2025-01-01', 3.0000, 15.0000, 3.7500, 0.3000, 1000000),
  ('claude-haiku-4-5',  date '2025-01-01', 1.0000,  5.0000, 1.2500, 0.1000,  200000)
on conflict (model, effective_date) do nothing;

-- ---------------------------------------------------------------- concepts (the semantic scaffold, OQ-9)
create table concepts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  short_definition text not null,
  explanation      text,
  status           concept_status_t not null default 'settled',
  search_tsv       tsvector generated always as (to_tsvector('english',
                     coalesce(name,'') || ' ' || coalesce(short_definition,'') || ' ' || coalesce(explanation,''))) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index concepts_search_idx on concepts using gin (search_tsv);
create index concepts_slug_trgm  on concepts using gin (slug gin_trgm_ops);
create index concepts_name_trgm  on concepts using gin (name gin_trgm_ops);

create table concept_edges (
  id              uuid primary key default gen_random_uuid(),
  concept_id      uuid not null references concepts(id) on delete cascade,
  prerequisite_id uuid not null references concepts(id) on delete cascade,
  status          concept_link_status_t not null default 'confirmed',
  created_at      timestamptz not null default now(),
  unique (concept_id, prerequisite_id),
  constraint concept_edges_no_self check (concept_id <> prerequisite_id)
);
create index concept_edges_concept_idx on concept_edges (concept_id);
create index concept_edges_prereq_idx  on concept_edges (prerequisite_id);

-- Concept -> hypothesis links by stable text code (resolved at read time; a
-- removed hypothesis degrades to an admin-visible drift flag).
create table concept_links (
  id         uuid primary key default gen_random_uuid(),
  concept_id uuid not null references concepts(id) on delete cascade,
  code       text not null,
  status     concept_link_status_t not null default 'confirmed',
  created_at timestamptz not null default now(),
  unique (concept_id, code)
);
create index concept_links_concept_idx on concept_links (concept_id);
create index concept_links_code_idx    on concept_links (code);

create table concept_gap_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint concept_gap_scan_singleton check (id)
);

-- Atlas-wide hypothesis gap scan (recommend-only; Start draft prefills the form).
create table argument_gap_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint argument_gap_scan_singleton check (id)
);

-- ---------------------------------------------------------------- research library
-- Papers/documents worth deep reading, entered by hand or from a curated source
-- (no automated pull). Findings are ADVISORY: papers never write evidence; the
-- only road into the record is promotion to a signal + the publish gate.
create table papers (
  id                   uuid primary key default gen_random_uuid(),
  url                  text not null unique,
  source_id            uuid references sources(id) on delete set null,
  title                text not null,
  abstract             text,
  authors              jsonb not null default '[]'::jsonb,
  published_at         date,
  triage_status        paper_triage_t not null default 'kept',  -- manual adds are pre-approved
  triage_reason        text,
  triage_summary       text,
  touches              text[] not null default '{}',            -- ADVISORY hypothesis codes only
  suggested_concepts   text[] not null default '{}',
  suggested_threads    text[] not null default '{}',
  raw_content          text,
  fetched_via          text,                                    -- 'source'
  extraction           jsonb,
  rigor_prior          int check (rigor_prior between 0 and 100),
  review_status        paper_review_t not null default 'pending',
  review_note          text,
  reviewed_at          timestamptz,
  signal_id            uuid references signals(id) on delete set null,
  agent_recommendation paper_review_t,
  agent_reason         text,
  agent_confidence     int check (agent_confidence between 0 and 100),
  agent_cluster        text,
  agent_at             timestamptz,
  search_tsv           tsvector generated always as (to_tsvector('english',
                         coalesce(title,'') || ' ' ||
                         left(coalesce(abstract,''), 20000) || ' ' ||
                         coalesce(extraction->>'headline_claim','') || ' ' ||
                         coalesce(extraction->>'strategy_implication','') || ' ' ||
                         coalesce(triage_summary,''))) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index papers_review_idx    on papers (triage_status, review_status);
create index papers_published_idx on papers (published_at desc);
create index papers_signal_idx    on papers (signal_id);
create index papers_search_idx    on papers using gin (search_tsv) where triage_status = 'kept';

create table research_threads (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  question   text not null,
  synthesis  text,
  status     thread_status_t not null default 'open',
  search_tsv tsvector generated always as (to_tsvector('english',
               coalesce(title,'') || ' ' || coalesce(question,'') || ' ' ||
               left(coalesce(synthesis,''), 100000))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index research_threads_search_idx on research_threads using gin (search_tsv);

create table thread_papers (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references research_threads(id) on delete cascade,
  paper_id   uuid not null references papers(id) on delete cascade,
  relation   thread_relation_t not null default 'context',
  why        text,
  status     concept_link_status_t not null default 'confirmed',
  created_at timestamptz not null default now(),
  unique (thread_id, paper_id)
);
create index thread_papers_thread_idx on thread_papers (thread_id);
create index thread_papers_paper_idx  on thread_papers (paper_id);

create table thread_revisions (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references research_threads(id) on delete cascade,
  synthesis    text not null,
  trigger_note text,
  created_at   timestamptz not null default now()
);
create index thread_revisions_thread_idx on thread_revisions (thread_id, created_at desc);

create table paper_concepts (
  id           uuid primary key default gen_random_uuid(),
  paper_id     uuid not null references papers(id) on delete cascade,
  concept_slug text not null,
  status       concept_link_status_t not null default 'confirmed',
  created_at   timestamptz not null default now(),
  unique (paper_id, concept_slug)
);
create index paper_concepts_paper_idx   on paper_concepts (paper_id);
create index paper_concepts_concept_idx on paper_concepts (concept_slug);

create table research_thread_scan (
  id             boolean primary key default true,
  recommendation jsonb not null,
  generated_at   timestamptz not null default now(),
  constraint research_thread_scan_singleton check (id)
);

create table research_agent_prefs (
  id boolean primary key default true check (id),
  steering text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- feedback box
create table tickets (
  id uuid primary key default gen_random_uuid(),
  kind ticket_kind_t not null,
  status ticket_status_t not null default 'open',
  title text not null,
  body text not null,
  email text not null,
  severity text,
  page text,
  user_agent text,
  admin_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table ticket_images (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  content_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);
create index tickets_status_idx      on tickets (status, created_at desc);
create index ticket_images_ticket_idx on ticket_images (ticket_id);

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'hypotheses','sources','signals','evidence','content_blocks','pipeline_runs',
    'signal_candidates','reports','concepts','papers','research_threads','tickets'
  ]
  loop
    execute format('create trigger trg_%s_updated before update on %I for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS (deny-by-default)
do $$
declare t text;
begin
  foreach t in array array[
    'hypotheses','hypothesis_links','sources','signals','evidence','snapshots','rationales',
    'content_blocks','digest_snapshots','pipeline_runs','signal_candidates','dedupe_scan',
    'reports','generated_reports','hypothesis_reports','ai_rate_cards','ai_cost_log',
    'concepts','concept_edges','concept_links','concept_gap_scan','argument_gap_scan',
    'papers','research_threads','thread_papers','thread_revisions','paper_concepts',
    'research_thread_scan','research_agent_prefs','tickets','ticket_images'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- 0023_research.sql — the Research section (/research): arXiv papers, the triage
-- funnel, research threads (living synthesis pages), and manual-run checkpoint state.
-- Design: docs/research-section.md.
--
-- Boundaries this schema encodes:
--   * Papers NEVER write evidence directly. claim_touches here is advisory only;
--     the sole road into the Argument Map is promotion to a signal (papers.signal_id,
--     via the existing pre-approved-candidate path) and the human publish gate.
--   * Runs are manual, console-driven, and DB-checkpointed (Hobby 60s cap) — these
--     tables ARE the checkpoint state, mirroring pipeline_runs/signal_candidates.
--   * Not everything in `papers` is an arXiv paper: manual adds (NBER/SSRN/lab
--     reports) carry origin='manual' with a null arxiv_id and dedup on url.

create type paper_origin_t    as enum ('arxiv', 'manual');
create type paper_triage_t    as enum ('pending', 'kept', 'rejected');
create type paper_review_t    as enum ('pending', 'noted', 'tracked', 'dismissed');
create type thread_status_t   as enum ('open', 'settled', 'dormant');
create type thread_relation_t as enum ('supports', 'complicates', 'contradicts', 'context');
create type research_step_t   as enum ('pull', 'triage', 'review', 'complete');

-- ---------------------------------------------------------------- research_runs
-- One row per manual research run; reuses run_status_t from the discovery pipeline.
-- since_date is the pull window's start (last run's high-water mark, capped at 14d).
create table research_runs (
  id             uuid primary key default gen_random_uuid(),
  triggered_at   timestamptz not null default now(),
  status         run_status_t    not null default 'running',
  step           research_step_t not null default 'pull',
  since_date     date not null,
  scanned_count  int not null default 0,   -- arXiv entries examined by the pull
  pulled_count   int not null default 0,   -- papers inserted (new to the library)
  kept_count     int not null default 0,
  rejected_count int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_research_runs_updated
  before update on research_runs
  for each row execute function set_updated_at();

create index on research_runs (triggered_at desc);
alter table research_runs enable row level security;

-- ---------------------------------------------------------------- papers
-- The research library: one row per paper, permanent (not run-scoped staging like
-- signal_candidates — a paper outlives its run; run_id is provenance only).
-- Funnel state (triage_*) and the personal layer (review_*, rigor_prior) live on
-- the row; extraction (phase 2) is the structured finding, stored as jsonb.
create table papers (
  id                   uuid primary key default gen_random_uuid(),
  origin               paper_origin_t not null default 'arxiv',
  arxiv_id             text unique,          -- versionless, e.g. '2607.07708'; null for non-arXiv
  url                  text not null unique, -- canonical abs URL for arXiv; the added URL for manual
  run_id               uuid references research_runs(id) on delete set null,
  source_id            uuid references sources(id) on delete set null, -- "Send to research"
  title                text not null,
  abstract             text,
  authors              jsonb not null default '[]'::jsonb,  -- string array
  categories           text[] not null default '{}',
  comments             text,                 -- arXiv comment field (the venue-acceptance signal)
  arxiv_version        int,
  published_at         date,                 -- arXiv v1 submission date (or the manual entry's date)
  arxiv_updated        date,
  -- funnel state (manual adds enter as 'kept' — human before the expensive call)
  triage_status        paper_triage_t not null default 'pending',
  triage_reason        text,                 -- model-written one-line relevance
  claim_touches        text[] not null default '{}',  -- ADVISORY codes only, never evidence
  suggested_concepts   text[] not null default '{}',  -- concept slugs, confirmed via paper_concepts
  suggested_threads    text[] not null default '{}',  -- thread slugs, confirmed via thread_papers
  -- analysis (phase 2): cached full text + the structured finding
  raw_content          text,
  fetched_via          text,                 -- 'direct' | 'jina' | 'html'
  extraction           jsonb,
  rigor_prior          int check (rigor_prior between 0 and 100),
  -- personal layer: the review decision + its why (the rationales discipline)
  review_status        paper_review_t not null default 'pending',
  review_note          text,
  reviewed_at          timestamptz,
  -- promotion is ADDITIVE, not a move: the paper stays here; signal_id links the two
  signal_id            uuid references signals(id) on delete set null,
  -- self-correction (phase 4): Semantic Scholar refresh, in-session only
  citation_count       int,
  citations_checked_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_papers_updated
  before update on papers
  for each row execute function set_updated_at();

create index on papers (run_id, triage_status);
create index on papers (triage_status, review_status);
create index on papers (review_status);
create index on papers (published_at desc);
create index on papers (signal_id);
alter table papers enable row level security;

-- ---------------------------------------------------------------- research_threads
-- The frontier questions the research web hangs off. `synthesis` is the living,
-- model-maintained page (admin-triggered updates only); every rewrite is preserved
-- in thread_revisions (the snapshots discipline applied to prose).
create table research_threads (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  question   text not null,               -- the frontier framing, one sentence
  synthesis  text,                        -- the living page; null until first update
  status     thread_status_t not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_research_threads_updated
  before update on research_threads
  for each row execute function set_updated_at();

alter table research_threads enable row level security;

-- ---------------------------------------------------------------- thread_papers
-- Paper <-> thread placement with a relation + one-line why. Reuses
-- concept_link_status_t (0017): the model proposes 'suggested', the human confirms —
-- the same propose->queue flow the concepts tables were future-proofed for.
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

create index on thread_papers (thread_id);
create index on thread_papers (paper_id);
alter table thread_papers enable row level security;

-- ---------------------------------------------------------------- thread_revisions
-- Append-only history of every synthesis rewrite, so the thread's story drift is
-- inspectable. The current text lives on research_threads.synthesis; each write
-- (including the first) also inserts its new text here with what triggered it.
create table thread_revisions (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references research_threads(id) on delete cascade,
  synthesis    text not null,
  trigger_note text,                      -- e.g. 'update after tracking 2607.07708'
  created_at   timestamptz not null default now()
);

create index on thread_revisions (thread_id, created_at desc);
alter table thread_revisions enable row level security;

-- ---------------------------------------------------------------- paper_concepts
-- Paper -> concept links by slug (text, resolved at read time — survives reseeding,
-- degrades to a drift flag). Reuses concept_link_status_t like thread_papers.
create table paper_concepts (
  id           uuid primary key default gen_random_uuid(),
  paper_id     uuid not null references papers(id) on delete cascade,
  concept_slug text not null,
  status       concept_link_status_t not null default 'confirmed',
  created_at   timestamptz not null default now(),
  unique (paper_id, concept_slug)
);

create index on paper_concepts (paper_id);
create index on paper_concepts (concept_slug);
alter table paper_concepts enable row level security;

-- ---------------------------------------------------------------- research_thread_scan
-- Singleton persistence for the model-proposed-new-threads scan (phase 3), mirroring
-- concept_gap_scan/argument_gap_scan: recommend-only, reconciled on read.
create table research_thread_scan (
  id             boolean primary key default true,
  recommendation jsonb not null,
  generated_at   timestamptz not null default now(),
  constraint research_thread_scan_singleton check (id)
);
alter table research_thread_scan enable row level security;

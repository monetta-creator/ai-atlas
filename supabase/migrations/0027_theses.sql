-- 0027 — Standing theses + frozen thesis reports (the AlphaSense-style claim-in,
-- cited-report-out surface, scoped to the Atlas's collected signals).
--
-- A thesis is a saved user hypothesis ("AI is reducing entry-level knowledge-work
-- hiring") mapped, human-confirmed, to the argument-map claims it bears on. Each
-- report is one frozen run against it: the deterministic evidence pack + computed
-- stats live in `pack` (jsonb, guest-safe by construction — the report is publicly
-- shareable, so no confidence, rationale, or reliability prior ever enters it),
-- the cited AI narrative in `narrative` (sanitized HTML, citation-gated). Reports
-- are immutable rows: a re-run inserts a new row; `signal_ids` lets the next run
-- diff against this one ("since last run: N new signals").
--
-- RLS enabled with no policies on both tables (deny-by-default; the app's DB role
-- bypasses — all access is server-mediated), matching the rest of the schema.

create type thesis_status_t as enum ('active', 'archived');

create table theses (
  id           uuid primary key default gen_random_uuid(),
  statement    text not null,
  claim_codes  text[] not null default '{}',   -- confirmed mapping to claims/bridge_claims (stable codes)
  mapping_note text,                           -- the mapping call's note / admin context
  status       thesis_status_t not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_theses_updated
  before update on theses
  for each row execute function set_updated_at();

alter table theses enable row level security;

create table thesis_reports (
  id           uuid primary key default gen_random_uuid(),
  thesis_id    uuid not null references theses(id) on delete cascade,
  title        text not null default 'Untitled thesis report',
  statement    text not null,                  -- the thesis wording frozen at generation time
  pack         jsonb not null,                 -- deterministic evidence pack + stats (guest-safe)
  narrative    jsonb not null,                 -- sanitized, citation-gated HTML sections + audit
  signal_ids   uuid[] not null default '{}',   -- the matched signals (delta diffing across runs)
  generated_at timestamptz not null,
  created_at   timestamptz not null default now()
);

create index on thesis_reports (thesis_id, generated_at desc);

alter table thesis_reports enable row level security;

-- Rebuild signals.search_tsv (0020: title + summary only) to also cover the deep-dive
-- analysis prose (0022's brief + counterpoint jsonb), so thesis retrieval matches on the
-- richer text. Generated columns cannot be altered in place: drop + re-add + re-index.
-- jsonb ->> is immutable, so it is valid in a generated column.
drop index if exists signals_search_idx;
alter table signals drop column search_tsv;
alter table signals add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
    coalesce(brief->>'what_happened', '') || ' ' || coalesce(brief->>'why_it_matters', '') || ' ' ||
    coalesce(brief->>'whats_contested', '') || ' ' ||
    coalesce(counterpoint->>'the_other_read', ''))) stored;
create index signals_search_idx on signals using gin (search_tsv);

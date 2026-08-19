-- 0020_ask_fts.sql — full-text + trigram search for "Ask the Atlas" (/ask)
--
-- The grounded chatbot retrieves records by Postgres full-text search over the
-- text-heavy content columns, so the model answers only from real rows and cites
-- each by its stable ID. Embeddings were considered and rejected: the citable
-- corpus is ~74 records (6 questions, 18 stances, 25 claims, 4 bridges, 21
-- concepts), small enough that the full ID namespace ships in the prompt as a
-- skeleton, so lexical + structural retrieval needs no vector infra and adds no
-- per-query embedding round-trip on the latency-sensitive, 60s-capped path.
--
-- Additive only: generated tsvector columns + GIN indexes + pg_trgm (the trigram
-- indexes back a future fuzzy code/slug correction pass). RLS is already enabled
-- on every table from 0001/0004/0017; adding columns and indexes does not touch it.

create extension if not exists pg_trgm;

-- Generated tsvector columns over the natural-language fields a user asks about.
-- to_tsvector with an explicit config ('english') is immutable, so it is valid in
-- a generated column.
alter table claims add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(statement, '') || ' ' || coalesce(test, '') || ' ' || coalesce(domain_note, ''))) stored;

alter table bridge_claims add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(statement, '') || ' ' || coalesce(test, '') || ' ' || coalesce(note, ''))) stored;

alter table stances add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(test, ''))) stored;

alter table concepts add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(name, '') || ' ' || coalesce(short_definition, '') || ' ' || coalesce(explanation, ''))) stored;

alter table signals add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, ''))) stored;

alter table evidence add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(excerpt, '') || ' ' || coalesce(note, ''))) stored;

create index claims_search_idx        on claims        using gin (search_tsv);
create index bridge_claims_search_idx on bridge_claims using gin (search_tsv);
create index stances_search_idx       on stances       using gin (search_tsv);
create index concepts_search_idx      on concepts      using gin (search_tsv);
create index signals_search_idx       on signals       using gin (search_tsv);
create index evidence_search_idx      on evidence      using gin (search_tsv);

-- Trigram indexes for fuzzy code/slug/name correction (e.g. a user who types
-- "unit economics" instead of "unit-economics"). Used by similarity() lookups.
create index claims_code_trgm        on claims        using gin (code gin_trgm_ops);
create index bridge_claims_code_trgm on bridge_claims using gin (code gin_trgm_ops);
create index stances_code_trgm       on stances       using gin (code gin_trgm_ops);
create index concepts_slug_trgm      on concepts      using gin (slug gin_trgm_ops);
create index concepts_name_trgm      on concepts      using gin (name gin_trgm_ops);
create index questions_slug_trgm     on questions     using gin (slug gin_trgm_ops);

-- Seed the Anthropic claude-haiku-4-5 rate card so /ask calls are priced (USD per
-- 1M tokens): input $1.00, output $5.00, 5-min cache write $1.25 (1.25x input),
-- cache read $0.10 (0.1x input), 200,000-token context window. Same backdated
-- pattern as the sonnet card in 0014; conflict-safe if the migration is re-applied.
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('claude-haiku-4-5', date '2025-01-01', 1.0000, 5.0000, 1.2500, 0.1000, 200000)
on conflict (model, effective_date) do nothing;

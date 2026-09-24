-- 0066_embeddings.sql — hybrid retrieval for Ask: pgvector storage for chunked
-- record text, plus the ask_prefs singleton that gates FTS-only vs hybrid
-- (lexical + vector) retrieval. See private/docs (hybrid-retrieval plan) for
-- the full design; this migration only lays down storage.
--
-- record_id is TEXT (not uuid): a chunk's owning record is a uuid for
-- signals/candidates/scan_items/intel_items/intel_facts/papers, but a stable
-- CODE for claims/bridges/stances, a SLUG for concepts/threads. One column
-- has to fit both key shapes, and the app never needs to join it back through
-- Postgres FK machinery (the join-back happens in application SQL against
-- each source table, mirroring the FTS legs' guest-safety predicates).
--
-- Cosine similarity (the OpenAI/OpenRouter embedding convention) via pgvector's
-- <=> operator, backed by an HNSW index. RLS enabled with no policies, deny by
-- default, matching every other table (the app's DB role bypasses).

create extension if not exists vector;

create table embeddings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in (
               'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
               'paper', 'claim', 'bridge', 'stance', 'concept', 'thread'
             )),
  record_id  text not null,
  chunk_no   integer not null default 0,
  model      text not null,
  text_hash  text not null,          -- sha256 of the embedded chunk text; skip re-embedding when unchanged
  vec        vector(1536) not null,  -- openai/text-embedding-3-small dimensionality
  created_at timestamptz not null default now(),
  unique (kind, record_id, chunk_no, model)
);

create index embeddings_hnsw_idx on embeddings
  using hnsw (vec vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index embeddings_kind_record_idx on embeddings (kind, record_id);

alter table embeddings enable row level security;

-- The embedding model's rate card (migration 0014's ai_rate_cards shape,
-- 0041's insert style): OpenRouter's openai/text-embedding-3-small, USD per
-- million tokens, no output/cache tiers (an embeddings call has no completion
-- and no prompt cache). context_window is the model's 8,191-token input cap.
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('openai/text-embedding-3-small', date '2026-09-24', 0.0200, 0, 0, 0, 8191)
on conflict (model, effective_date) do nothing;

-- ---------------------------------------------------------------- ask_prefs
-- Hybrid retrieval starts OFF (retrieval = 'fts'): the vector leg is measured
-- against the gold set (scripts/ab-retrieval.mjs, plan step 4) before it ever
-- reorders a real answer's context. Flipping it is a pref write, no deploy.
create table ask_prefs (
  id         boolean primary key default true check (id),
  retrieval  text not null default 'fts' check (retrieval in ('fts', 'hybrid')),
  updated_at timestamptz not null default now()
);

create trigger trg_ask_prefs_updated
  before update on ask_prefs
  for each row execute function set_updated_at();

alter table ask_prefs enable row level security;

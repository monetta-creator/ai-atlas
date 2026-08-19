-- 0031_research_fts.sql — full-text search over the research corpus for /ask.
--
-- Papers and threads join the Ask retrieval corpus (the research-portal rework,
-- 2026-08-14): guests can already read findings and syntheses, so retrieval over
-- them is guest-safe by construction. Indexed text is the public editorial layer
-- only: bibliography + abstract + the extraction's headline/econ fields for
-- papers (never review_note, never raw_content), title + question + synthesis
-- for threads.
--
-- The papers index is partial (triage_status = 'kept'): rejected/pending-triage
-- rows are never retrieved. left() guards the tsvector ceiling like 0029.
--
-- Additive only. RLS is already enabled on both tables (0023); columns/indexes
-- do not touch it.

alter table papers add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' ||
    left(coalesce(abstract, ''), 20000) || ' ' ||
    coalesce(extraction->>'headline_claim', '') || ' ' ||
    coalesce(extraction->>'econ_implication', '') || ' ' ||
    coalesce(triage_summary, ''))) stored;

alter table research_threads add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(question, '') || ' ' ||
    left(coalesce(synthesis, ''), 100000))) stored;

create index papers_search_idx on papers
  using gin (search_tsv) where triage_status = 'kept';
create index research_threads_search_idx on research_threads using gin (search_tsv);

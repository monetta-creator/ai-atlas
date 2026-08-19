-- 0029_portal_fts.sql — full-text search over article text for the Datasets portal Ask.
--
-- The portal's team-facing Ask surface (/datasets/ask) retrieves article excerpts,
-- not just record summaries. Article text lives in two places, neither indexed by
-- 0020: sources.raw_text (manually ingested articles/PDFs) and
-- signal_candidates.raw_content (pipeline-fetched page text; ensureSource never
-- copies it to sources, so pipeline-born sources are bare bibliography rows).
-- Retrieval unions the two, always scoped through published signals or curated
-- evidence-attached sources; excerpts come from ts_headline, full articles never
-- enter the prompt.
--
-- left(..., 200000) guards the 1MB tsvector ceiling (largest text today ~100KB,
-- average ~18KB) and bounds the per-row index cost. The candidates index is
-- partial (signal_id is not null): text is only ever surfaced through a published
-- signal, so candidates that never became one need no index entry.
--
-- Additive only. RLS is already enabled on both tables; columns/indexes do not touch it.

alter table sources add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || left(coalesce(raw_text, ''), 200000))) stored;

alter table signal_candidates add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(headline, '') || ' ' || left(coalesce(raw_content, ''), 200000))) stored;

create index sources_search_idx on sources using gin (search_tsv);
create index signal_candidates_search_idx on signal_candidates
  using gin (search_tsv) where signal_id is not null;

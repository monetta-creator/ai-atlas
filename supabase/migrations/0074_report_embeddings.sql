-- 0074_report_embeddings.sql (2026-09-27): Ask reads the Atlas's own
-- editorial reports (the Daily Edition, the research roundup, Savant). Each
-- published report is embedded per SECTION (record_id '<report uuid>:<section
-- key>', lib/embed/report-sections.ts), so a hit maps to one passage and one
-- anchor; and generated_reports gains a lexical index so an exact phrase from
-- an issue is findable by the FTS leg too.
alter table embeddings drop constraint if exists embeddings_kind_check;
alter table embeddings add constraint embeddings_kind_check check (kind in (
  'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
  'paper', 'claim', 'bridge', 'stance', 'concept', 'thread', 'report'));

-- jsonb::text and regexp_replace are immutable, so the column can be generated.
alter table generated_reports add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || regexp_replace(narrative::text, '<[^>]+>', ' ', 'g'))
  ) stored;
create index if not exists generated_reports_search_idx on generated_reports using gin (search_tsv);

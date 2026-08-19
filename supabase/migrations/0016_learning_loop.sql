-- 0016: learning-loop columns on signal_candidates (additive, no new tables).
--
-- fetched_via — how the candidate's readable text was obtained ('direct' | 'jina').
-- A domain whose successes are reader-only is fetch-hostile: future candidates from it
-- skip the doomed direct attempt and go straight to the reader.
--
-- discovery_queries — the web-search query batch that surfaced the candidate (null for
-- manual uploads and pre-feature rows). Makes query-level hit rates learnable: which of
-- the static lens queries ever yield approved/drafted signals, and which are dead weight.

alter table signal_candidates add column if not exists fetched_via text;
alter table signal_candidates add column if not exists discovery_queries text[];

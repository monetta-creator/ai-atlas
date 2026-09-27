-- 0077_backfill_enum_values.sql (2026-09-27): the backfill's provenance
-- values, split from 0076 because a new enum value cannot be used in the
-- transaction that adds it.
--   signals.origin 'backfill': drafts from the since-ChatGPT history. The
--     auto-publish sweep only ever publishes origin 'pipeline', and the Daily
--     Edition and Savant's weekly reads exclude this origin.
--   pipeline_runs.cadence 'backfill': the one run row that carries the
--     backfill's candidates, kept out of the daily run logic and analytics
--     like 'source'.
--   papers.origin 'backfill': the research canon, written with a triage status
--     so the live research engine never picks it up.
alter type signal_origin_t add value if not exists 'backfill';
alter type run_cadence_t add value if not exists 'backfill';
alter type paper_origin_t add value if not exists 'backfill';

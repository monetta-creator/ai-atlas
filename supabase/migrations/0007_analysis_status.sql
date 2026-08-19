-- 0007_analysis_status.sql
-- Per-candidate analysis outcome, so the home dashboard can report REAL analysis-step
-- health (drafted vs errored vs discarded) instead of inferring it from signal_id alone.
-- Additive only: a new enum + two columns on signal_candidates, plus a one-time backfill
-- of historical rows from state we already track. No existing column is modified.
--
-- The pipeline writes these alongside its existing flow (lib/pipeline/analysis.ts via the
-- analyze action / mutations): a successful draft sets 'drafted'; a failed attempt sets
-- 'error' (+ message); a candidate terminalized after retries ('unanalyzable:') sets
-- 'discarded'. triage_status is left untouched by analysis, so the triage funnel and the
-- analysis-health view stay independently honest.
create type analysis_status_t as enum ('pending', 'drafted', 'error', 'discarded');

alter table signal_candidates
  add column analysis_status analysis_status_t not null default 'pending',
  add column analysis_error  text;

-- Backfill from what we already know:
--   a candidate with a linked signal was drafted;
--   a candidate the orchestrator terminalized writes triage_reason 'unanalyzable: …' and
--   has no signal — that is an analysis discard.
update signal_candidates set analysis_status = 'drafted'
  where signal_id is not null;

update signal_candidates set analysis_status = 'discarded'
  where signal_id is null
    and triage_status = 'rejected'
    and triage_reason like 'unanalyzable:%';

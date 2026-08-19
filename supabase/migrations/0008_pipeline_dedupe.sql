-- 0008 — Post-pipeline qualitative dedupe of a run's unpublished drafts.
--
-- Additive only: a jsonb column to checkpoint the AI's grouped duplicate recommendation on
-- the run (so the manual review survives a page refresh, matching the pipeline's
-- checkpoint-everything design), plus a timestamp of the last scan. NO enum/run_step_t
-- change — dedupe is an OPTIONAL, MANUAL, post-completion review the admin triggers with a
-- button, not a sequential pipeline stage. RLS stays deny-by-default (the app role bypasses).
alter table pipeline_runs
  add column if not exists dedupe_recommendation jsonb,
  add column if not exists dedupe_run_at timestamptz;

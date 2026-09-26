-- 0073_ui_jobs_cost.sql (2026-09-27): the actual cost of a finished run, so
-- the panel, the toast and the ops board can say "done in 1:58, $0.31".
-- Computed at finish from ai_cost_log over the features the job's steps
-- declared (lib/mutations/jobs.ts finishUiJob), since the job started.
alter table ui_jobs add column if not exists cost_usd numeric(10, 4);

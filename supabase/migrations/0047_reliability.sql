-- 0047: reliability + observability fixes from the 2026-09-01 cron audit.
--
-- papers.triage_attempts: counts triage claims per paper so a paper whose
-- decision keeps going missing (model truncation, shifted indices) is retried
-- up to 3 times instead of fail-closed rejected on the first miss. Bumped by
-- the claim UPDATE in lib/mutations/research.ts; exhausted papers are bulk-
-- rejected by the engine with a distinct reason.
--
-- pipeline_runs.notes: the same per-run issue notes scan_runs (0040),
-- intel_runs (0043), and research_runs (0046) already carry. The pipeline
-- engine has always produced notes and dropped them on the floor (they only
-- rode the cron HTTP response).

alter table papers add column triage_attempts int not null default 0;

alter table pipeline_runs add column notes text[] not null default '{}';

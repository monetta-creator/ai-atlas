-- 0026: post-run coverage check (the Kimi-K3 audit — a run that silently misses the
-- week's headline event should say so at review time).
--
-- coverage — jsonb written once per run by the coverage step (lib/pipeline/coverage.ts):
--   { since, checked_at, developments: [{ headline, url, covered, matched }] }
-- One web-enabled call re-derives "the most significant AI developments since the
-- window opened" with INDEPENDENT query phrasing, then marks each covered/missed
-- against the run's candidates + existing signals. Null for pre-feature runs and for
-- runs whose check failed (the step is advisory and never blocks a run).

alter table pipeline_runs add column if not exists coverage jsonb;

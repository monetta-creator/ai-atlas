-- 0042_pipeline2.sql — Discovery Pipeline 2.0 (2026-08-29): cheap providers,
-- cron cadence, server-side engine, analysis A/B.
--
-- pipeline_prefs (the scan_prefs singleton pattern): `enabled` gates the CRON
-- leg only (console runs bypass, an admin clicking IS the override);
-- `analysis_models` is the A/B picker selection (empty = the Sonnet fallback
-- path); `utility_model` is the triage/sweep-judge/coverage-judge model (null
-- = the DEFAULT_UTILITY_MODEL const in lib/pipeline/config.ts).
--
-- pipeline_runs gains the two columns the scan engine pattern needs and the
-- original console-driven design never had: `discovered_units` (per-unit
-- discovery checkpoints, entries like 'market:0' and 'sweep' — the batch plan
-- used to live only client-side) and `lease_until` (the overlap guard letting
-- two cron invocations share a run safely).
--
-- signals.drafted_by stamps which model drafted a pipeline signal (null =
-- human/manual or pre-2.0). Admin-only surface: it is never SELECTed by any
-- guest read or dataset builder.

create table pipeline_prefs (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,
  analysis_models text[] not null default '{}',
  utility_model   text,
  updated_at      timestamptz not null default now()
);
alter table pipeline_prefs enable row level security;

alter table pipeline_runs add column discovered_units text[] not null default '{}';
alter table pipeline_runs add column lease_until timestamptz;

alter table signals add column drafted_by text;

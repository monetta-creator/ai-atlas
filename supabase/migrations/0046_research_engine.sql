-- 0046_research_engine.sql — Research joins the house daily-engine pattern
-- (the scan_runs/intel_runs shape): a day-keyed checkpointed run with a lease
-- for overlap-safe cron resumption, persisted per-run notes (the 0040
-- pattern), and a runtime on/off + model-picker singleton (the scan_prefs /
-- pipeline_prefs pattern, 0039/0042).
--
-- The OLD manual, console-driven run flow (research_runs rows with day null,
-- driven by startResearchRunAction / pullArxivPageAction /
-- triageResearchChunkAction) is untouched: day is nullable and the new
-- unique index is partial, so both flows share the table without colliding.
--
-- research_step_t gains two steps the engine walks that the manual console
-- flow never used: 'agent' (the queue-agent recommendation pass over the
-- pending review queue) and 'analyze' (per-paper hydrate + finding
-- extraction, budget-guarded, over agent-recommended papers). 'review' stays
-- defined but unused (kept for compatibility with any historical row).
--
-- papers.analyzed_by stamps which model produced a paper's extraction (null =
-- Sonnet/pre-engine, or a manual analyze click); a later pass wires the A/B
-- picker that fills it in — this migration only adds the column.
--
-- report_kind_t gains 'roundup' for a sibling task's weekly research digest
-- report; included here so there is one migration touching this enum today.
-- Postgres allows ADD VALUE inside the migration runner's transaction but
-- forbids USING the new value in the same transaction (the 0028 lesson) —
-- nothing in this file inserts a row carrying 'agent', 'analyze', or
-- 'roundup', so the two enum alters below are safe alongside the rest.

alter table research_runs add column day date;
alter table research_runs add column lease_until timestamptz;
alter table research_runs add column notes text[] not null default '{}';

create unique index research_runs_day_key on research_runs (day) where day is not null;

alter type research_step_t add value if not exists 'agent';
alter type research_step_t add value if not exists 'analyze';

alter table papers add column analyzed_by text;

-- The scan_prefs singleton pattern: `enabled` gates the CRON leg only (the
-- console's manual tick ignores it, an admin clicking IS the override);
-- `triage_model` / `analysis_models` are the utility/A/B picker selections
-- for a later cheap-model-routing pass — null / empty means the existing
-- Sonnet-only path (runStructured with no model override).
create table research_prefs (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,
  triage_model    text,
  analysis_models text[] not null default '{}',
  updated_at      timestamptz not null default now()
);
alter table research_prefs enable row level security;

alter type report_kind_t add value if not exists 'roundup';

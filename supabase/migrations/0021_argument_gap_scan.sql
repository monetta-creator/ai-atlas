-- 0021 — Argument-map gap-scan persistence.
--
-- The /map admin "Diagnose gaps" feature: one model call reads recent evidence
-- (the latest saved reports + the signals behind them) against the existing
-- Argument Map and recommends NEW claims / bridge-claims that recent
-- developments demand but the map cannot yet express. Report-grounded and
-- restraint-biased: every recommendation must cite the report/signal that
-- motivates it, and recommending NOTHING is a correct, common outcome.
--
-- Recommend-only — a recommendation only ever pre-fills the create form (only the
-- proposed code travels in the URL; the body is re-read here); the form submit
-- remains the sole writer. The latest scan persists in a singleton row (mirroring
-- concept_gap_scan / dedupe_scan) so the review survives a refresh and is
-- reconciled against live codes on read (a recommendation whose proposed code now
-- names a live claim/bridge is dropped). RLS deny-by-default; the app role
-- bypasses, like every other table.

create table if not exists argument_gap_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint argument_gap_scan_singleton check (id)
);
alter table argument_gap_scan enable row level security;

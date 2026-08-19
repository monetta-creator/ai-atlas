-- 0018 — Concept gap-scan persistence.
--
-- The /concepts admin "Diagnose gaps" feature: one model call reads the existing
-- scaffold + the Argument Map and recommends NEW concepts (with an argument for
-- what each bridges and why the scaffold needs it). Recommend-only — a
-- recommendation only ever pre-fills the create form; the form submit remains
-- the sole writer. The latest scan persists in a singleton row (mirroring
-- dedupe_scan) so the review survives a refresh and is reconciled against live
-- concepts on read (a recommendation whose slug now exists is dropped).
-- RLS deny-by-default; the app role bypasses, like every other table.

create table if not exists concept_gap_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint concept_gap_scan_singleton check (id)
);
alter table concept_gap_scan enable row level security;

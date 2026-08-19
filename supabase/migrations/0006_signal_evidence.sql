-- 0006_signal_evidence.sql — make EVIDENCE the canonical link between a Signal and a
-- Claim/Bridge-Claim. Until now the Signal Board and the Argument Map were two disjoint
-- subsystems meeting only by string-code coincidence (signals.claim_touches text[]).
-- A signal never produced evidence; the model's per-touch reason was computed and
-- discarded, and direction was never assessed. This migration adds the structural
-- joint so a published signal materializes real evidence rows (see lib/mutations.ts
-- syncSignalEvidence). The human gate holds: evidence enters the map only on PUBLISH.
--
-- All changes are additive — no destructive column-type change, no backfill of live
-- data. Existing evidence keeps its source_id (the new CHECK passes); existing signals
-- get touch_details '{}'. Re-publishing a signal materializes its evidence.

-- ---------------------------------------------------------------- evidence: signal provenance
-- A signal can be its own source ("the signal IS the source"): source_id becomes
-- nullable and signal_id is added, with a CHECK that at least one anchor is present.
-- on delete cascade: signal-derived evidence is a finding FROM that signal, so it dies
-- with the signal (manual evidence has signal_id null and is unaffected).
alter table evidence add column signal_id uuid references signals(id) on delete cascade;
alter table evidence alter column source_id drop not null;
alter table evidence add constraint evidence_provenance_chk
  check (source_id is not null or signal_id is not null);

-- The audience lens this finding speaks to (the Signal Board's signal_lens_t, NOT the
-- argument map's lens_t). Nullable — manual source-attach evidence may carry none.
alter table evidence add column lens signal_lens_t;

create index on evidence (signal_id);

-- ---------------------------------------------------------------- signals: draft-stage touch detail
-- Per-touch {direction, reason} keyed by claim/bridge code, e.g.
--   { "2.3": { "direction": "supports", "reason": "…" }, "B1": { "direction": "contradicts", "reason": "…" } }
-- claim_touches text[] stays the code list (display, digest, resolveTouches); this is
-- the editable detail the admin reviews before publish and that becomes evidence.
-- Codes here are a subset of claim_touches (enforced in the action writer).
alter table signals add column touch_details jsonb not null default '{}'::jsonb;

-- Backs the reverse "which signals touch this claim" query (claim_touches @> array['2.3']).
create index on signals using gin (claim_touches);

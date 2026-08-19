-- Unify the manual signal path with the discovery pipeline. A manual upload is turned into
-- a signal through the SAME triage -> analyze -> draft path as discovery, by routing it as a
-- pre-approved candidate. Two additions support that:
--   1. a 'source' run cadence for single-source runs, so they can be kept out of the discovery
--      run history + analytics (and out of the discovery lookback window) without losing them.
--   2. signal_candidates.source_id, linking a manual candidate to its existing curated source
--      so analysis reuses the source's text/metadata/prior instead of ensureSource'ing a bare row.
--
-- ADD VALUE is only ADDED here (never USED in this migration), so it is transaction-safe on
-- PG12+ (Supabase is PG15+) even though scripts/migrate.mjs wraps each file in a transaction.

alter type run_cadence_t add value if not exists 'source';

alter table signal_candidates
  add column source_id uuid references sources(id) on delete set null;

-- Supports the idempotency guard (find an in-flight/already-converted candidate for a source).
create index on signal_candidates (source_id);

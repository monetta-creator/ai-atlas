-- 0040_scan_notes.sql — persist the scan engine's per-run notes (feed
-- failures, search failures, budget trips, hydrate-wave failures). Until now
-- these were returned to the invoking caller and discarded, which made
-- feed-health invisible across days; the /scan health panel reads them back
-- as the "recent issues" feed. Appended deduplicated by the writer, capped
-- at 40 per run.

alter table scan_runs add column notes text[] not null default '{}';

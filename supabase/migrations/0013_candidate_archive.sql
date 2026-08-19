-- 0013_candidate_archive.sql — let a discovered candidate be ARCHIVED (set aside) without
-- deleting it, mirroring the signal-archive precedent (0009: signals.archived_at).
-- A "needs manual" item (rejected + unanalyzable) or any stale candidate can be archived
-- out of the active review queue and the funnel's live buckets, then restored later.
--
-- archived_at is ORTHOGONAL to triage_status: the candidate keeps whatever triage decision
-- it had; archiving is a separate "out of the queue" flag with an audit timestamp. The
-- funnel-composition view counts archived as its own segment and excludes it from the other
-- buckets (so it leaves "Pending review" / "Rejected" etc.), keeping the partition exact.
-- Additive and nullable; existing rows default to NULL (not archived).

alter table signal_candidates add column archived_at timestamptz;

-- Partial: only the (few) archived rows are indexed — backs the "archived" filter and the
-- archived-aware analytics counts without bloating the hot path.
create index signal_candidates_archived_idx
  on signal_candidates (archived_at)
  where archived_at is not null;

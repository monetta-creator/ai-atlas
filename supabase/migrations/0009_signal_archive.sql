-- 0009 — Archive for unpublished signals.
--
-- A draft you've reviewed but don't want to publish OR delete: archiving sets it aside, out
-- of the active Draft queue and out of the dedupe scan, but keeps it (unarchive restores it).
-- Additive nullable column; archived ⇔ archived_at IS NOT NULL (and is_published = false —
-- publishing clears archived_at). Partial index for the archived view. RLS unchanged.
alter table signals add column if not exists archived_at timestamptz;
create index if not exists signals_archived_idx on signals (archived_at) where archived_at is not null;

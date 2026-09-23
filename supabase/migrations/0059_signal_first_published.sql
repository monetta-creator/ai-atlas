-- When a signal FIRST went public. published_at is the editorial date (the
-- article's date for pipeline drafts, author-editable), so it cannot say when
-- the signal reached readers; the Daily Edition windows its signals leg on
-- this column so a draft published days after its article still makes that
-- day's paper. Stamped once by every publishing writer
-- (lib/mutations/signals.ts: insertSignalRow, setSignalPublished,
-- publishDueDrafts) and never moved by unpublish/republish.
alter table signals add column if not exists first_published_at timestamptz;

-- Backfill: the true publish time was never recorded, so use the best
-- available: the promotion policy's stamp, else the editorial date (the
-- edition's previous behavior).
update signals
   set first_published_at = coalesce(auto_published_at, published_at)
 where is_published = true and first_published_at is null;

create index if not exists signals_first_published_at_idx
  on signals (first_published_at) where is_published = true;

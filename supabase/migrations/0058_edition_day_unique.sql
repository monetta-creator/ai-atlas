-- One daily edition per day. runDailyEdition checks getEditionForDay before
-- its 60-120s of model legs, so an overlapping cron + manual run (or a
-- ?day= backfill of today) could both pass the check and insert. This index
-- makes the second insert fail with 23505, which run.ts reports as skipped.
-- Separate from 0057 because Postgres cannot use an enum value ('edition')
-- added earlier in the same transaction.
--
-- Before applying, check for existing duplicates (the index creation fails
-- otherwise) and delete the extras:
--   select scope_to, count(*) from generated_reports
--    where kind = 'edition' group by 1 having count(*) > 1;
create unique index if not exists generated_reports_edition_day_uq
  on generated_reports (scope_to) where kind = 'edition';

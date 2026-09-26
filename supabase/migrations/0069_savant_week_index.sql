-- 0069: one Savant issue per week (scope_to = the Friday), the 0058 / 0062
-- idiom, in its own file because 0068 adds the enum value and Postgres
-- refuses to use a new enum value inside the transaction that created it.
create unique index if not exists generated_reports_savant_week_uq
  on generated_reports (scope_to) where kind = 'savant';

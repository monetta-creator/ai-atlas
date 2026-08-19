-- 0011 — Saved reports (persistence for the report generator).
--
-- A generated/edited report, stored so it survives refresh, can be re-opened in the editor,
-- and exported later. The full serialized Report object lives in `data` (jsonb, narrative
-- HTML sanitized at the save boundary); the metadata columns drive the saved-reports list.
-- RLS enabled with no policies (deny-by-default; the app's DB role bypasses), matching the
-- rest of the schema. updated_at maintained by the shared set_updated_at() trigger (0001).
create table reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled report',
  date_from    date not null,
  date_to      date not null,
  lenses       signal_lens_t[] not null default '{}',
  generated_at timestamptz not null,            -- the report's own model-run timestamp
  data         jsonb not null,                  -- the full serialized Report object
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_reports_updated
  before update on reports
  for each row execute function set_updated_at();

create index on reports (updated_at desc);

alter table reports enable row level security;

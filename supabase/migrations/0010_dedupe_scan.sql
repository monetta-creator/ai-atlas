-- 0010 — Board-level dedupe persistence + drop the vestigial 0008 run columns.
--
-- 0008 added pipeline_runs.dedupe_recommendation / dedupe_run_at for a run-scoped dedupe that
-- was later replaced by a board-level scan over ALL unpublished drafts. Those columns are
-- unused — drop them. Then persist the latest board-level scan in a singleton table so the
-- review survives a refresh (reconciled against live drafts on read). RLS deny-by-default;
-- the app role bypasses, like every other table.
alter table pipeline_runs
  drop column if exists dedupe_recommendation,
  drop column if exists dedupe_run_at;

create table if not exists dedupe_scan (
  id boolean primary key default true,
  recommendation jsonb not null,
  generated_at timestamptz not null default now(),
  constraint dedupe_scan_singleton check (id)
);
alter table dedupe_scan enable row level security;

-- 0072_ui_jobs.sql (2026-09-27): the model-run registry behind the shared
-- run panel (lib/jobs/*, components/jobs/*). Every button that starts a
-- model call registers a job here and moves its steps along, so a run
-- survives leaving the page: the rail shows what is running, a toast says
-- when it finished, and the panel resumes from the row on return.
--
--   kind        what kind of run ('sheet', 'thesis', 'savant_issue', 'single:<feature>', ...)
--   subject     the resume key (claim code, thesis id, week, run id)
--   steps       [{key,label,state,startedAt,endedAt,note,attempt}], state todo|running|done|failed
--   actor       'admin' | 'cron' | 'agent' | 'key:<portal_keys.id>' (a keyholder sees only their own)
--   updated_at  the heartbeat: a running row untouched for 10 minutes reads as lost
create table if not exists ui_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  subject      text,
  label        text not null,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  steps        jsonb not null default '[]'::jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  result_href  text,
  error        text,
  actor        text not null default 'admin',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ui_jobs_active_idx on ui_jobs (updated_at desc) where status in ('queued', 'running');
create index if not exists ui_jobs_kind_subject_idx on ui_jobs (kind, subject, created_at desc);
create index if not exists ui_jobs_finished_idx on ui_jobs (finished_at desc) where finished_at is not null;

drop trigger if exists trg_ui_jobs_updated on ui_jobs;
create trigger trg_ui_jobs_updated before update on ui_jobs for each row execute function set_updated_at();

alter table ui_jobs enable row level security;

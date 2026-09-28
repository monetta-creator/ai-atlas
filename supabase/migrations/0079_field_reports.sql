-- 0079_field_reports.sql (2026-09-28): Field Report, Ask's research-report
-- mode (docs/field-report.md). A person asks, the Atlas drafts an editable
-- research plan, and a background run researches the Atlas first, then the
-- web for gaps, and writes a labeled, cited report.

-- One row per plan/run. `legs` parks each finished leg (per-sub-question
-- findings, the evidence ledger, the draft, the editor's notes, figures) so a
-- run that hits its deadline resumes from the next leg.
create table if not exists field_report_runs (
  id          uuid primary key default gen_random_uuid(),
  created_by  text not null,                    -- 'admin' | 'key:<portal key id>'
  question    text not null,
  plan        jsonb not null,
  size        text not null default 'brief' check (size in ('brief', 'full')),
  status      text not null default 'planned' check (status in ('planned', 'running', 'paused', 'done', 'failed')),
  legs        jsonb not null default '{}'::jsonb,
  report_id   uuid references generated_reports(id) on delete set null,
  job_id      uuid,
  error       text,
  cost_usd    numeric(10, 4) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists field_report_runs_owner_idx on field_report_runs (created_by, created_at desc);
drop trigger if exists trg_field_report_runs_updated on field_report_runs;
create trigger trg_field_report_runs_updated before update on field_report_runs for each row execute function set_updated_at();
alter table field_report_runs enable row level security;

-- Who ran a generated report: null for the system and admin, 'key:<id>' for a
-- keyholder. A keyholder's draft is visible to them and admin only.
alter table generated_reports add column if not exists created_by text;

-- The settings singleton behind /field-reports/desk.
create table if not exists field_report_prefs (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,
  models          jsonb not null default '{
    "brief": {"research": "claude-sonnet-5", "writer": "claude-sonnet-5", "editor": "claude-sonnet-5", "figures": "claude-sonnet-5"},
    "full":  {"research": "claude-sonnet-5", "writer": "claude-opus-5-5", "editor": "claude-sonnet-5", "figures": "claude-sonnet-5"}
  }'::jsonb,
  effort          jsonb not null default '{"brief": "medium", "full": "high"}'::jsonb,
  web_searches    jsonb not null default '{"brief": 4, "full": 12}'::jsonb,
  key_daily_usd   numeric(8, 2) not null default 5,
  all_keys_daily_usd numeric(8, 2) not null default 20,
  updated_at      timestamptz not null default now()
);
insert into field_report_prefs (id) values (true) on conflict (id) do nothing;
drop trigger if exists trg_field_report_prefs_updated on field_report_prefs;
create trigger trg_field_report_prefs_updated before update on field_report_prefs for each row execute function set_updated_at();
alter table field_report_prefs enable row level security;

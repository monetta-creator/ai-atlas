-- 0039_scan_prefs.sql — the External Scan's runtime switch (the scout_prefs
-- singleton pattern). Vercel cron SCHEDULES are deploy-time config
-- (vercel.json); what the app can own at runtime is whether the crons DO
-- anything: /api/cron/scan checks `enabled` and exits before creating a run
-- when the scan is paused. The /scan console's manual Run/resume deliberately
-- ignores this flag (an admin clicking IS the override).

create table scan_prefs (
  id         boolean primary key default true check (id),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table scan_prefs enable row level security;

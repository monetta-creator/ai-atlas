-- 0045_home_widgets.sql — the Lobby's customizable widget board (the
-- scan_prefs singleton pattern). `widgets` is the admin's ordered pick list
-- of widget catalog keys (lib/widgets/catalog.ts); a missing row or an empty
-- array falls back to DEFAULT_WIDGETS in code, so the singleton is created
-- lazily by the first save, same as scan_prefs/pipeline_prefs.

create table home_prefs (
  id         boolean primary key default true check (id),
  widgets    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table home_prefs enable row level security;

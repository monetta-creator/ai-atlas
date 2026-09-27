-- 0075_board_prefs.sql (2026-09-27): the widget boards, keyed by board. The
-- lobby ('home') leans public; the admin board ('ops', /ops) holds the
-- operations widgets. One saved layout per board, edited by the same
-- Customize panel. The old home_prefs singleton (0045) stays untouched and
-- unread (a later cleanup can drop it); both boards start from the code
-- defaults in lib/widgets/catalog.ts, since the old lobby layout was mostly
-- the admin widgets that now live on /ops.
create table if not exists board_prefs (
  board      text primary key check (board in ('home', 'ops')),
  widgets    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_board_prefs_updated on board_prefs;
create trigger trg_board_prefs_updated before update on board_prefs for each row execute function set_updated_at();
alter table board_prefs enable row level security;

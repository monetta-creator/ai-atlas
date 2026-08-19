-- Content overrides: per-key text that overrides the hardcoded default copy on the
-- About pages and the landing header. Production is a read-only serverless filesystem,
-- so DB overrides are the only way to edit site text without a redeploy. A missing key
-- falls back to the code default, so nothing here is required for the app to render.
-- `key` is a dotted namespace string (e.g. about.overview.lede); `value` replaces it.
create table content_blocks (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_content_blocks_updated
  before update on content_blocks
  for each row execute function set_updated_at();

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table content_blocks enable row level security;

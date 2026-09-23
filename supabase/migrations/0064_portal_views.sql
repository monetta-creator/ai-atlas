-- Saved views for the Data Portal (Phase 4 of the data-provider program).
--
-- A view is a named filter spec over one dataset: the same where/cols/sort/
-- limit/q grammar the download route accepts (lib/datasets/filter.ts), stored
-- as jsonb and RE-VALIDATED against the live registry every time it is
-- applied, so a view can never widen a dataset (the dataset's own gate still
-- runs) or introduce a column the registry does not carry. Owned by a
-- per-person key (cascade on revoke-and-delete), by the legacy shared key
-- (key_id null, owner 'legacy'), or by the admin. is_shared views appear to
-- every keyholder as "Team views"; the owner and the admin may edit.

create table if not exists portal_views (
  id            uuid primary key default gen_random_uuid(),
  key_id        uuid references portal_keys(id) on delete cascade,
  owner         text not null check (owner in ('key', 'legacy', 'admin')),
  dataset_slug  text not null,
  name          text not null check (length(name) between 1 and 80),
  spec          jsonb not null default '{}'::jsonb,
  format        text not null default 'csv' check (format in ('csv', 'json')),
  is_shared     boolean not null default true,
  use_count     integer not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists portal_views_dataset_idx on portal_views (dataset_slug, created_at desc);
create index if not exists portal_views_key_idx on portal_views (key_id, created_at desc);

alter table portal_views enable row level security;

-- portal_usage.kind gains the view lifecycle events (the 0060 check listed
-- view_save only). Recreate the constraint additively.
alter table portal_usage drop constraint if exists portal_usage_kind_check;
alter table portal_usage add constraint portal_usage_kind_check
  check (kind in ('enter', 'dataset', 'schema', 'nl_query', 'ask', 'deck', 'view_save', 'view_use', 'view_delete'));

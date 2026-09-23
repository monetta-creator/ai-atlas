-- Per-person access keys for the portal tier (2026-09-23). Until now one shared
-- PORTAL_KEY unlocked Ask and the key-gated datasets for everyone; it stays
-- valid as the legacy team key (cookie value 'portal'). A per-person key is
-- atlas_<prefix8>_<secret32>: the prefix is stored in clear for lookup, the
-- whole key only as an HMAC-SHA256 under AUTH_SECRET (lib/portal/keys.ts).
-- The key is shown once at issuance and never stored in clear.
create table if not exists portal_keys (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text,
  key_prefix            text not null unique,
  key_hash              text not null,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  last_used_at          timestamptz,
  daily_ask_budget_usd  numeric(6,2) not null default 0.25,
  daily_ask_max_calls   int not null default 60,
  notes                 text,
  request_id            uuid
);

-- The public "Request access" form (POST /api/access/request). One row per
-- request; approving issues a key and links it. ip_hash is an HMAC of the
-- caller's address for abuse review, never the address itself.
create table if not exists portal_access_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  reason       text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  key_id       uuid references portal_keys(id) on delete set null,
  user_agent   text,
  ip_hash      text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists portal_access_requests_status_idx on portal_access_requests (status, created_at desc);

-- What each key did: dataset pulls, schema reads, Ask turns, NL queries, deck
-- views, view saves. identity 'legacy' rows carry no key_id (the shared team
-- key), 'admin' rows are the maintainer's own portal use. Inserted
-- fire-and-forget after the response; anonymous public downloads are not logged.
create table if not exists portal_usage (
  id            uuid primary key default gen_random_uuid(),
  key_id        uuid references portal_keys(id) on delete cascade,
  identity      text not null check (identity in ('key', 'legacy', 'admin')),
  kind          text not null check (kind in ('enter', 'dataset', 'schema', 'nl_query', 'ask', 'deck', 'view_save')),
  dataset_slug  text,
  spec          jsonb,
  rows          int,
  bytes         int,
  status        int,
  ua            text,
  created_at    timestamptz not null default now()
);
create index if not exists portal_usage_key_idx on portal_usage (key_id, created_at desc);
create index if not exists portal_usage_created_idx on portal_usage (created_at desc);

-- Per-key Ask spend: every portal-triggered recordApiCall stamps
-- metadata.portal_key_id, so the per-key daily budget is one indexed sum.
create index if not exists ai_cost_log_portal_key_idx
  on ai_cost_log ((metadata->>'portal_key_id'), created_at)
  where metadata ? 'portal_key_id';

alter table portal_keys enable row level security;
alter table portal_access_requests enable row level security;
alter table portal_usage enable row level security;

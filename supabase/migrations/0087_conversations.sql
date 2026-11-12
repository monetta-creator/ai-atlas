-- 0087_conversations.sql (2026-11-11): server-side conversations for the one
-- chat box (redo Phase 4, P4.1). Until now Ask conversations lived only in
-- the browser's localStorage; background agents posting back into a thread,
-- phone-to-desktop continuity, and search over past chats need them here.
-- owner is 'admin' or 'key:<portal_keys.id>' (never a guest). A message keeps
-- its text in `content` and everything the client renders around it (cost,
-- verify report, decision, chips, sources, lane, steps, enhance card) in
-- `extras`; `tag_map` is the frozen citation tag -> record id map. Archive,
-- never hard-delete, from the app. RLS on, no public policies.
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner = 'admin' or owner like 'key:%'),
  title text not null default '',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists conversations_owner_idx on conversations (owner, updated_at desc) where archived_at is null;

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  extras jsonb not null default '{}'::jsonb,
  tag_map jsonb not null default '{}'::jsonb,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);
create index if not exists conversation_messages_convo_idx on conversation_messages (conversation_id, seq);

alter table conversations enable row level security;
alter table conversation_messages enable row level security;

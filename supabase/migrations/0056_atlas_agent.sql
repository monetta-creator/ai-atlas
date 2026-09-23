-- 0056_atlas_agent.sql - the Atlas Agent: the resident operator that watches
-- every queue, engine and editorial surface, files findings, runs the
-- reversible fixes itself and tees up the rest. Full write-up: the approved
-- plan (private/docs, not checked in). Four tables, RLS enabled with no
-- public policies (deny-by-default, the house pattern: the app's DB role
-- bypasses RLS, every access is server-mediated), admin-only throughout.
--
-- agent_findings: one row per (check, subject) pair, upserted by `key`
-- ('<check>[:<subject>]', e.g. 'drafts.backlog', 'engine.failed:scan'). The
-- hourly runner opens/updates/resolves these; a finding a check stops firing
-- auto-resolves. `remedy` carries the RemedyRef the card renders (key, args,
-- tier, label) or null when there is nothing to do but look. `last_action_at`
-- is the cooldown anchor for auto-tier remedies (12h, enforced in
-- lib/agent/remedies.ts).
--
-- agent_actions: the audit log for every remedy execution, `agent` (the cron
-- tick), `kevin` (the drawer) or `kevin_chat` (the chat's run_remedy tool).
-- finding_id is a soft FK (set null on delete, so a finding's history never
-- blocks its own deletion); finding_key is denormalized alongside it so the
-- log stays readable after a finding is gone.
--
-- agent_briefs: one row per day (upsert on day), the morning memo plus the
-- findings/actions snapshot it was written from, so a later read shows
-- exactly what the model saw. emailed_at is null until sendBriefEmail
-- succeeds (or RESEND_API_KEY is unset, in which case it never fires).
--
-- agent_prefs: the singleton (the scan_prefs/pipeline_prefs pattern). enabled
-- gates the CRON leg only, same convention as every other engine toggle;
-- auto_enabled is the separate master switch for the auto-tier remedies.

create table if not exists agent_findings (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  check_key       text not null,
  subject         text,
  severity        text not null check (severity in ('info', 'warn', 'high')),
  title           text not null,
  detail          text not null,
  metric          jsonb not null default '{}',
  href            text,
  remedy          jsonb,
  state           text not null default 'open' check (state in ('open', 'acked', 'snoozed', 'resolved')),
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  resolved_at     timestamptz,
  snoozed_until   timestamptz,
  seen_at         timestamptz,
  acked_at        timestamptz,
  last_action_at  timestamptz
);
alter table agent_findings enable row level security;

create index if not exists agent_findings_state_severity_idx
  on agent_findings (state, severity, last_seen desc);
create index if not exists agent_findings_open_last_seen_idx
  on agent_findings (last_seen) where state = 'open';

create table if not exists agent_actions (
  id           uuid primary key default gen_random_uuid(),
  finding_id   uuid references agent_findings(id) on delete set null,
  finding_key  text,
  remedy_key   text not null,
  args         jsonb not null default '{}',
  tier         text not null check (tier in ('auto', 'propose', 'never')),
  actor        text not null check (actor in ('agent', 'kevin', 'kevin_chat')),
  ok           boolean not null,
  result       jsonb,
  error        text,
  cost_usd     numeric not null default 0,
  created_at   timestamptz not null default now()
);
alter table agent_actions enable row level security;

create index if not exists agent_actions_created_at_idx on agent_actions (created_at desc);

create table if not exists agent_briefs (
  id                 uuid primary key default gen_random_uuid(),
  day                date not null unique,
  memo               jsonb not null,
  findings_snapshot  jsonb,
  actions_snapshot   jsonb,
  emailed_at         timestamptz,
  model              text,
  created_at         timestamptz not null default now()
);
alter table agent_briefs enable row level security;

create table if not exists agent_prefs (
  id           boolean primary key default true check (id),
  enabled      boolean not null default true,
  auto_enabled boolean not null default true,
  chat_model   text not null default 'z-ai/glm-5.3-flash',
  brief_model  text not null default 'z-ai/glm-5.3-flash',
  steering     text not null default '',
  email_to     text,
  updated_at   timestamptz not null default now()
);
alter table agent_prefs enable row level security;

insert into agent_prefs (id) values (true) on conflict do nothing;

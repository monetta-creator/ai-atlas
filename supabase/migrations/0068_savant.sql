-- 0068: Savant, the Atlas's autonomous weekly research report (2026-09-26).
-- Savant researches through the week (a notebook of deterministic passes:
-- cross-store connections found through the embeddings table, metric
-- anomalies, coverage misses, one cheap daily note) and on Friday writes a
-- key-gated issue for people doing AI transformation in banking, reviewed by
-- an independent editor persona and published on its own. Every issue poses
-- one new hypothesis and carries the open ones forward: the ledger below is
-- Savant's memory. Public data only; the reader organization is the intel
-- registry's `self` tier and its name never enters the code.

alter type report_kind_t add value if not exists 'savant';

-- The one-issue-per-week unique index lives in 0069: a new enum value
-- cannot be referenced in the transaction that adds it (the 0061/0062 split).

-- The weekly notebook: appended by the weekday pass and by the Friday run,
-- rendered as the issue's "How this was researched" appendix. `key` makes a
-- day's pass idempotent (the same connection or anomaly found twice in one
-- day upserts instead of duplicating).
create table if not exists savant_notebook (
  id         uuid primary key default gen_random_uuid(),
  week_end   date not null,                       -- the issue's Friday
  day        date not null,                       -- the day the row was written for
  kind       text not null check (kind in ('plan', 'note', 'connection', 'echo', 'anomaly', 'miss', 'query', 'editor')),
  key        text not null,                       -- dedupe key within (week_end, day, kind)
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  unique (week_end, day, kind, key)
);
create index if not exists savant_notebook_week_idx on savant_notebook (week_end, day);
alter table savant_notebook enable row level security;

-- The hypotheses ledger: one row per hypothesis Savant has posed; Friday
-- appends this week's update to every open one and inserts the new one.
create table if not exists savant_hypotheses (
  id            uuid primary key default gen_random_uuid(),
  statement     text not null,
  question_slug text,
  posed_week    date not null,
  status        text not null default 'open' check (status in ('open', 'strengthened', 'weakened', 'closed')),
  verdict       text,
  what_would_settle text[] not null default '{}',
  watch         text[] not null default '{}',
  updates       jsonb not null default '[]'::jsonb,   -- [{ week, direction, note, hrefs }]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists savant_hypotheses_status_idx on savant_hypotheses (status, posed_week desc);
create trigger trg_savant_hypotheses_updated
  before update on savant_hypotheses
  for each row execute function set_updated_at();
alter table savant_hypotheses enable row level security;

-- The singleton prefs (the edition_prefs pattern). enabled gates the crons
-- only; the models are the cheap-provider / Sonnet picks per leg.
create table if not exists savant_prefs (
  id             boolean primary key default true check (id),
  enabled        boolean not null default true,
  writer_model   text not null default 'claude-sonnet-4-6',
  editor_model   text not null default 'claude-sonnet-4-6',
  notebook_model text not null default 'z-ai/glm-5.3-flash',
  editor_name    text not null default 'the Desk Editor',
  lead_rotation  text[] not null default '{capability,build-out,unit-economics,mispricing,rent,geopolitics,labor}',
  lead_override  text,                              -- a one-off topic for the next issue; cleared when used
  email_enabled  boolean not null default false,
  updated_at     timestamptz not null default now()
);
insert into savant_prefs (id) values (true) on conflict do nothing;
create trigger trg_savant_prefs_updated
  before update on savant_prefs
  for each row execute function set_updated_at();
alter table savant_prefs enable row level security;

-- Per-key opt-in to the Friday email (Phase 3). Keys already carry the
-- holder's email (0060).
alter table portal_keys add column if not exists savant_email boolean not null default false;

-- The ONE registry field allowed into Savant's prompts as reader-organization
-- context: a public-facing blurb the maintainer writes from public sources.
-- `notes` (admin free text) and `dossier` (model-written) never enter a prompt.
alter table intel_companies add column if not exists public_blurb text;

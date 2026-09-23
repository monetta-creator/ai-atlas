-- 0057: the daily edition (Task 4, 2026-09-23).
--
-- The edition is a generated_reports row like the weekly roundup and the
-- tooling reports: kind 'edition', scope_from/to = the edition's day, pack =
-- EditionPack (guest-safe by construction), narrative = EditionNarrative
-- (front items + the Levine-style column). It auto-publishes (Kevin's call,
-- 2026-09-23: /blotter/<day> must work sessionless), the third auto-publishing
-- kind after roundup and tooling_entrants.
--
-- edition_prefs is the singleton the scan/intel/tooling prefs rows already
-- pattern: enabled gates the cron leg, model picks the cheap provider
-- (default GLM, the pipeline/scan/intel/tooling standard), front_items bounds
-- how many stories the front page carries.

alter type report_kind_t add value if not exists 'edition';

create table if not exists edition_prefs (
  id            boolean primary key default true check (id),
  enabled       boolean not null default true,
  model         text not null default 'z-ai/glm-5.3-flash',
  front_items   int not null default 6 check (front_items between 4 and 8),
  updated_at    timestamptz not null default now()
);
alter table edition_prefs enable row level security;
insert into edition_prefs (id) values (true) on conflict do nothing;

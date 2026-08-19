-- The Report Portal's generated reports (claim/bridge tear sheets, lens deep
-- reports, the whole-Atlas executive briefing). Period reports (`reports`) and
-- thesis reports (`thesis_reports`) keep their own tables; this holds the new
-- kinds. Insert-only like thesis_reports: a re-run is a NEW row. The one mutable
-- field is is_published, the human gate that lists a report on the public portal
-- and opens its PDF download (matching the signal-publish convention).

create type report_kind_t as enum ('claim', 'bridge', 'lens', 'atlas');

create table generated_reports (
  id           uuid primary key default gen_random_uuid(),
  kind         report_kind_t not null,
  subject      text,                    -- claim/bridge code or lens slug; null for 'atlas'
  title        text not null default 'Untitled report',
  scope_from   date,                    -- both null = all-time scope
  scope_to     date,
  pack         jsonb not null,          -- deterministic, guest-safe evidence pack + stats
  narrative    jsonb not null,          -- sanitized, citation-gated HTML sections + audit
  is_published boolean not null default false,
  generated_at timestamptz not null,
  created_at   timestamptz not null default now()
);

create index on generated_reports (kind, generated_at desc);
create index on generated_reports (is_published, generated_at desc);

alter table generated_reports enable row level security;

-- 0080_context_pack.sql (2026-09-29): the Briefcase, company context packs
-- for a model that runs where the Atlas cannot reach (docs/context-pack.md).
--
-- A pack is rendered by code from public rows on every download
-- (lib/context-pack), so it needs no table of its own. The one stored piece
-- is the weekly model-written brief per section: short orientation prose,
-- gated before it is saved (every link is one of the section's own source
-- URLs, every figure appears in the section) and labeled as model-written
-- wherever it renders. One brief per company, section and issue week; a
-- pack shows the latest week's.

create table if not exists context_pack_briefs (
  id           uuid primary key default gen_random_uuid(),
  company_slug text not null references intel_companies(slug) on delete cascade,
  week_end     date not null,
  section_id   text not null,
  body         text not null,
  cite_urls    text[] not null default '{}' check (cardinality(cite_urls) > 0),
  dropped      text[] not null default '{}',
  model        text,
  created_at   timestamptz not null default now(),
  unique (company_slug, week_end, section_id)
);
create index if not exists context_pack_briefs_latest_idx on context_pack_briefs (company_slug, section_id, week_end desc);
alter table context_pack_briefs enable row level security;

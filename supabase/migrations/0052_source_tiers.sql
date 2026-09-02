-- 0052: source reliability tiers for the external scan and the intel desk.
--
-- relevance (topic fit, model-scored) was the only score on a scan item, so
-- on-topic junk outscored primary sources and a research house read as 0.55.
-- Reliability is now a separate, source-derived axis: suffix rules and a
-- curated map in lib/scan/source-tiers.ts decide most domains in code; a
-- domain neither covers is rated ONCE by the utility model and persisted here
-- (rated_by 'model'), so the long tail rates itself. Items are stamped at
-- collection time; the datasets ship source_tier, source_kind, content_kind
-- and a composed priority beside relevance.

create table if not exists source_tiers (
  domain           text primary key,
  tier             smallint not null check (tier between 1 and 4),
  kind             text not null check (kind in (
                     'regulator', 'primary', 'research', 'wire', 'major', 'trade', 'tech_press',
                     'general', 'aggregator', 'pr_wire', 'blog', 'social', 'promo', 'unknown')),
  rated_by         text not null check (rated_by in ('model', 'human')),
  reason           text,
  sample_headline  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table source_tiers enable row level security;

-- Per-item stamps. source_tier/source_kind come from the rules or the table at
-- collection time (null = not yet rated); content_kind comes from the
-- enrichment pass (news, analysis, data, press_release, marketing, opinion,
-- other) and discounts promotional text inside a good source.
alter table scan_items
  add column if not exists source_tier  smallint check (source_tier between 1 and 4),
  add column if not exists source_kind  text,
  add column if not exists content_kind text;

alter table intel_items
  add column if not exists source_tier  smallint check (source_tier between 1 and 4),
  add column if not exists source_kind  text,
  add column if not exists content_kind text;

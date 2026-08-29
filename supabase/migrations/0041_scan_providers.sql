-- 0041_scan_providers.sql — the scan's cheap-provider swap (2026-08-29).
-- The search leg moves to a direct news-search API (no LLM; env-gated in
-- code) and enrichment moves to OpenRouter-hosted open-weight models with a
-- /scan UI picker: `scan_prefs.enrich_models` holds the selected model ids
-- (empty = the claude-haiku-4-5 fallback path); selecting several
-- round-robins items across them (the A/B test), and `scan_items.enriched_by`
-- stamps which model enriched each item so per-model quality/cost stats can
-- be compared. Rate cards below price the curated OpenRouter shortlist
-- (values from OpenRouter's live catalog on 2026-08-29, USD per Mtok; these
-- models bill no cache tiers, so cache rates are 0).

alter table scan_prefs add column enrich_models text[] not null default '{}';

alter table scan_items add column enriched_by text;

insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('qwen/qwen3.7-flash',                       date '2026-08-29', 0.0300, 0.1300, 0, 0, 1000000),
  ('qwen/qwen3-30b-a3b-instruct-2507',         date '2026-08-29', 0.0480, 0.1930, 0, 0, 262144),
  ('z-ai/glm-5.3-flash',                       date '2026-08-29', 0.0750, 0.2500, 0, 0, 1310720),
  ('mistralai/mistral-small-3.2-24b-instruct', date '2026-08-29', 0.0750, 0.2000, 0, 0, 131072),
  ('deepseek/deepseek-v4-flash',               date '2026-08-29', 0.0830, 0.1660, 0, 0, 1048576),
  ('meta-llama/llama-4-scout',                 date '2026-08-29', 0.1100, 0.3400, 0, 0, 1310720)
on conflict (model, effective_date) do nothing;

-- 0071_open_reasoning_rate_cards.sql (2026-09-26): rate cards for the
-- open-weight reasoning tier the Savant desk offers beside the Claude
-- models and the scan's flash shortlist. Ids and prices from OpenRouter's
-- live catalog (GET /api/v1/models) on 2026-09-26, USD per million tokens;
-- OpenRouter bills no cache tiers for these, so the cache rates are 0.
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('deepseek/deepseek-v4-pro',           date '2026-09-26', 0.3480,  0.6960, 0, 0, 1048576),
  ('z-ai/glm-5.3',                       date '2026-09-26', 0.3790,  1.1920, 0, 0, 1310720),
  ('qwen/qwen3.8-max-0902',              date '2026-09-26', 2.0000,  6.0000, 0, 0, 1000000),
  ('moonshotai/kimi-k3',                 date '2026-09-26', 3.0000, 15.0000, 0, 0, 1048576),
  ('minimax/minimax-m3',                 date '2026-09-26', 0.3000,  1.2000, 0, 0, 1048576),
  ('nvidia/nemotron-3-ultra-550b-a55b',  date '2026-09-26', 0.6000,  2.4000, 0, 0,  262144)
on conflict do nothing;

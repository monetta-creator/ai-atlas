-- 0085_open_weight_rate_cards.sql (2026-11-11): rate cards for the open-weight
-- models the redo's model selector and decider offer (lib/llm/models.ts), so
-- recordApiCall prices their OpenRouter calls. Prices read from the live
-- OpenRouter /api/v1/models list on 2026-11-11, USD per million tokens
-- (input / output; OpenRouter bills no separate cache write here, so cache
-- columns are zero). deepseek-v4-pro already had a card (0071) at an older
-- price; this adds a newer effective_date row, so the active card moves.
-- Additive only: on conflict do nothing.
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('deepseek/deepseek-v4.1-flash',     date '2026-11-11', 0.0220,  0.4000, 0, 0, 1048576),
  ('google/gemma-4-26b-a4b-it',        date '2026-11-11', 0.0800,  0.1000, 0, 0, 262144),
  ('deepseek/deepseek-v4-pro',         date '2026-11-11', 0.9550,  1.9110, 0, 0, 1048576),
  ('mistralai/mistral-large-4-0',      date '2026-11-11', 0.7000,  2.1000, 0, 0, 1048576),
  ('moonshotai/kimi-k3.1-pro',         date '2026-11-11', 2.0000, 10.0000, 0, 0, 1048576),
  ('meta-llama/llama-3.1-8b-instruct', date '2026-11-11', 0.0200,  0.0400, 0, 0, 131072),
  ('openai/gpt-oss-120b',              date '2026-11-11', 0.1500,  0.6000, 0, 0, 131072),
  ('meta/muse-spark-open',             date '2026-11-11', 1.2500,  4.2500, 0, 0, 1048576)
on conflict do nothing;

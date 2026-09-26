-- 0070_claude_5_rate_cards.sql (2026-09-26): rate cards for the current
-- Claude generation so the Savant desk (and any picker) can offer them with
-- their spend counted against the budgets. Prices from platform.claude.com
-- /docs/en/about-claude/pricing on 2026-09-26, USD per million tokens:
-- Sonnet 5 $2 / $10 (5m cache write $2.50, read $0.20; the introductory
-- price made standard), Opus 5.5 $4 / $20 (write $5, read $0.20, the 0.05x
-- read multiplier), Fable 5.1 $10 / $50 (write $12.50, read $0.25, 0.025x).
-- All three carry the 1M-token window at standard pricing. Note for
-- estimates: models from 4.7 on use a tokenizer that yields about 30% more
-- tokens for the same text (lib/savant/cost-model.ts applies the factor).
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('claude-sonnet-5',   date '2026-09-26',  2.0000, 10.0000,  2.5000, 0.2000, 1000000),
  ('claude-opus-5-5',   date '2026-09-26',  4.0000, 20.0000,  5.0000, 0.2000, 1000000),
  ('claude-fable-5-1',  date '2026-09-26', 10.0000, 50.0000, 12.5000, 0.2500, 1000000)
on conflict do nothing;

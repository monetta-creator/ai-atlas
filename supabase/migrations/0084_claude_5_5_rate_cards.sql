-- 0084_claude_5_5_rate_cards.sql (2026-11-11): rate cards for Claude Haiku 5.5
-- and Sonnet 5.5, the redo's default answer model and the eval judge, so
-- recordApiCall prices them and the budget guards count them. USD per million
-- tokens from the Claude API model docs on 2026-11-11:
-- Haiku 5.5 $0.10 / $0.50 for prompts of 100K tokens or fewer (5m cache write
-- 1.25x = $0.125, read 0.1x = $0.01); prompts over 100K bill at $0.50 / $2.50,
-- which this single card does not model (the Ask loop keeps its input budget
-- under that line). Sonnet 5.5 $2 / $10 (write $2.50, read $0.10).
-- Additive only: on conflict do nothing.
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('claude-haiku-5-5',  date '2026-11-11', 0.1000,  0.5000, 0.1250, 0.0100, 1000000),
  ('claude-sonnet-5-5', date '2026-11-11', 2.0000, 10.0000, 2.5000, 0.1000, 1000000)
on conflict do nothing;

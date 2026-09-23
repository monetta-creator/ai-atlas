-- One company intel deck per day (the 0058 edition pattern): runIntelDeck
-- checks getIntelDeckForDay first, and this index makes a concurrent second
-- insert fail with 23505, which the runner reports as skipped.
create unique index if not exists generated_reports_intel_deck_day_uq
  on generated_reports (scope_to) where kind = 'intel_deck';

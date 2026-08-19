-- 0014_ai_cost.sql — AI cost monitoring: a pricing-history table + a per-call cost log.
--
-- Every successful Anthropic API call in the app writes one ai_cost_log row (lib/cost.ts
-- recordApiCall — fire-and-forget, never surfaces to the user). Cost is computed at write
-- time from the THEN-ACTIVE rate card and FROZEN on the row: a later price change never
-- recomputes past spend. Rate cards carry an effective_date and are append-only — a new
-- card applies from its date forward; past cards are never edited.
--
-- RLS enabled with no policies (deny-by-default; the app's DB role bypasses), matching the
-- rest of the schema. No updated_at/trigger: both tables are append-only.

-- Pricing history. One card per (model, effective_date). Rates are USD per MILLION tokens;
-- context_window is the model's total context size (drives the per-call utilization %).
create table ai_rate_cards (
  id                   uuid primary key default gen_random_uuid(),
  model                text not null,
  effective_date       date not null,                 -- the card applies from this date forward
  input_per_mtok       numeric(10,4) not null,
  output_per_mtok      numeric(10,4) not null,
  cache_write_per_mtok numeric(10,4) not null,        -- 5-min-TTL write rate (the app uses ephemeral cache_control)
  cache_read_per_mtok  numeric(10,4) not null,
  context_window       integer not null,
  created_at           timestamptz not null default now(),
  unique (model, effective_date)                       -- one rate per model per effective date
);

create index ai_rate_cards_model_date_idx on ai_rate_cards (model, effective_date desc);

alter table ai_rate_cards enable row level security;

-- Per-call cost log. Token counts, wall time, context-window utilization %, and the cost
-- FROZEN at call time. rate_card_id records which card priced it (audit; nulled if the card
-- is ever deleted, never changing the frozen cost). pipeline_run_id ties a call to its
-- discovery run for the per-run rollup.
create table ai_cost_log (
  id                  uuid primary key default gen_random_uuid(),
  feature             text not null,                  -- which app feature triggered the call (slug)
  model               text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  wall_ms             integer not null default 0,     -- request wall-clock (ms)
  context_pct         numeric(5,2),                   -- (input + cache read + cache write) / context window, 0–100
  cost_usd            numeric(12,6) not null default 0,   -- frozen at write time; never recomputed
  rate_card_id        uuid references ai_rate_cards(id) on delete set null,
  pipeline_run_id     uuid references pipeline_runs(id) on delete set null,
  metadata            jsonb not null default '{}',     -- caller extras (candidate_id, lens, web_search_requests, …)
  created_at          timestamptz not null default now()
);

create index ai_cost_log_created_idx on ai_cost_log (created_at desc);
create index ai_cost_log_feature_idx on ai_cost_log (feature);
create index ai_cost_log_run_idx on ai_cost_log (pipeline_run_id) where pipeline_run_id is not null;

alter table ai_cost_log enable row level security;

-- Seed the current Anthropic claude-sonnet-4-6 rate card (USD per 1M tokens): input $3.00,
-- output $15.00, 5-min cache write $3.75 (1.25× input), cache read $0.30 (0.1× input), and a
-- 1,000,000-token context window. Backdated so it prices all existing and future calls; a
-- future price change is a NEW row with a later effective_date (this row is never edited).
insert into ai_rate_cards
  (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
values
  ('claude-sonnet-4-6', date '2025-01-01', 3.0000, 15.0000, 3.7500, 0.3000, 1000000);

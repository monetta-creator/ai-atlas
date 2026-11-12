-- 0086_decisions.sql (2026-11-11): the decider's log (lib/decide). One row per
-- question answered for a turn: which backend answered (rules, logprob,
-- structured, default), the probability for every option, and latency.
-- `outcome` is filled later by labels (the eval's cheapest passing model, a
-- manual override in the selector, a retry with a bigger model), which is
-- what the learned router trains on. conversation_id has no FK yet: the
-- conversations table lands in a later migration. RLS on, no public policies.
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversation_id uuid,
  question_key text not null,
  situation_hash text not null,
  answer text not null,
  probabilities jsonb not null default '{}'::jsonb,
  backend text not null check (backend in ('rules', 'logprob', 'structured', 'default', 'learned', 'jev')),
  latency_ms integer not null default 0,
  outcome jsonb
);
create index if not exists decisions_created_idx on decisions (created_at desc);
create index if not exists decisions_situation_idx on decisions (situation_hash, question_key);
alter table decisions enable row level security;

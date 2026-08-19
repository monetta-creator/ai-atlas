-- 0019_supply_chain.sql — the AI supply-chain map overlay (/supply-chain)
--
-- The static structure (layers, nodes, edges) lives in lib/supply-chain/map.ts. The DB
-- holds only the mutable overlay (per-node risk_level + admin_note) and the node -> signal
-- links, both keyed by the node SLUG (text) and resolved at read time, the same pattern as
-- concept_claims and signals.claim_touches. No existing table is touched (signals is only
-- referenced by FK). Additive only.

create type risk_level_t as enum ('low', 'medium', 'high', 'critical');

-- Admin-mutable per-node overlay. Sparse: a row exists only once an admin sets something.
-- risk_level is a STUB, not a computed score; null means fall back to the TS riskDefault.
create table supply_chain_node_meta (
  slug        text primary key,            -- the stable node key from map.ts
  risk_level  risk_level_t,
  admin_note  text,                        -- admin-only (the personal layer for this surface)
  updated_at  timestamptz not null default now()
);

create trigger trg_supply_chain_node_meta_updated
  before update on supply_chain_node_meta
  for each row execute function set_updated_at();

-- Node -> signal links (by slug). A signal deletion cascades the link away.
create table supply_chain_node_signals (
  id         uuid primary key default gen_random_uuid(),
  node_slug  text not null,
  signal_id  uuid not null references signals(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (node_slug, signal_id)
);

create index on supply_chain_node_signals (node_slug);
create index on supply_chain_node_signals (signal_id);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table supply_chain_node_meta    enable row level security;
alter table supply_chain_node_signals enable row level security;

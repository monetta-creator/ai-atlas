-- 0017_concepts.sql — the semantic scaffold (/concepts)
-- A layered knowledge graph of AI terminology: foundational concepts at the
-- bottom, advanced ones at the top, connected by "understand X before Y"
-- dependency edges. Each concept carries a settled/contested status and links
-- to the argument-map claims/bridge-claims that invoke it. Same gate philosophy
-- as the rest of the Atlas: the model only ever RECOMMENDS prerequisite edges
-- and claim links; the human confirms before anything is written. Both link
-- tables carry a status column (suggested/confirmed) so a future
-- propose→queue→accept flow needs no migration — today the app writes only
-- 'confirmed' (human-committed) rows and public reads filter on it.

create type concept_status_t      as enum ('settled', 'contested');
create type concept_link_status_t as enum ('suggested', 'confirmed');

-- ---------------------------------------------------------------- concepts
create table concepts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  short_definition text not null,            -- the hover-tooltip one-liner
  explanation      text,                     -- the detail-page long form
  status           concept_status_t not null default 'settled',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_concepts_updated
  before update on concepts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- concept_edges
-- One dependency edge: "understand `prerequisite_id` before `concept_id`".
-- Kept acyclic by the writer (lib/mutations.ts walks the graph in-transaction
-- before committing a new prerequisite set — the layered layout needs a DAG).
create table concept_edges (
  id              uuid primary key default gen_random_uuid(),
  concept_id      uuid not null references concepts(id) on delete cascade,
  prerequisite_id uuid not null references concepts(id) on delete cascade,
  status          concept_link_status_t not null default 'confirmed',
  created_at      timestamptz not null default now(),
  unique (concept_id, prerequisite_id),
  constraint concept_edges_no_self check (concept_id <> prerequisite_id)
);

-- ---------------------------------------------------------------- concept_claims
-- Concept → claim/bridge links by stable text code (resolved at read time, the
-- way signals.claim_touches is) so the join survives reseeding and a removed
-- claim degrades to an admin-visible drift flag instead of a dangling uuid.
create table concept_claims (
  id          uuid primary key default gen_random_uuid(),
  concept_id  uuid not null references concepts(id) on delete cascade,
  target_type node_t not null,
  target_code text not null,
  status      concept_link_status_t not null default 'confirmed',
  created_at  timestamptz not null default now(),
  unique (concept_id, target_type, target_code),
  constraint concept_claims_target_kind check (target_type in ('claim', 'bridge_claim'))
);

-- ---------------------------------------------------------------- indexes
create index on concept_edges (concept_id);
create index on concept_edges (prerequisite_id);
create index on concept_claims (concept_id);
create index on concept_claims (target_type, target_code);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table concepts       enable row level security;
alter table concept_edges  enable row level security;
alter table concept_claims enable row level security;

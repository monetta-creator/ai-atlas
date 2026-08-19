-- Signal Board: a public feed of tracked AI developments, organized by lens and
-- linked back to the claims/bridge-claims they touch on the Argument Map. Authored,
-- not aggregated — a human adds a source, Claude proposes a draft, the human reviews
-- and publishes (the same model-proposes/human-commits gate as the rest of the app).
--
-- Lenses here are a SEPARATE, audience-tailored vocabulary from the argument map's
-- lens_t (which is market/economics/social/employment/education/geopolitics/stack).
-- The Signal Board's six lenses speak to a financial-institution analyst and include
-- "regulatory", which lens_t has no equivalent for — so they get their own enum.

create type significance_t as enum ('high', 'medium', 'low');

create type signal_lens_t as enum (
  'market',        -- Market & Valuation
  'labor',         -- Labor & Knowledge Work
  'geopolitics',   -- Geopolitics & Security
  'regulatory',    -- Regulatory & Legal
  'capability',    -- Technical Capability
  'society'        -- Societal & Cultural
);

-- ---------------------------------------------------------------- signals
-- A discrete tracked development. `lenses` and `claim_touches` are arrays carried on
-- the row itself (per the product spec), not join tables: claim_touches holds the
-- stable text codes of claims/bridge-claims (e.g. '2.3', 'B1'), resolved at read time.
-- `published_at` is the editorial date (shown + used for ordering and digest range
-- filtering); `is_published` is the separate visibility gate — guests see published
-- signals only, the author also sees drafts.
create table signals (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  summary       text,
  significance  significance_t not null default 'medium',
  lenses        signal_lens_t[] not null default '{}',
  claim_touches text[] not null default '{}',
  source_id     uuid references sources(id) on delete set null,  -- soft ref: deleting a source keeps the signal
  published_at  timestamptz not null default now(),              -- editorial date (author-editable)
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_signals_updated
  before update on signals
  for each row execute function set_updated_at();

-- Feed is newest-first by editorial date; partial index keeps the public read tight.
create index on signals (published_at desc);
create index on signals (is_published, published_at desc);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table signals enable row level security;

-- ---------------------------------------------------------------- digest_snapshots
-- Audit log for automated digest distribution (the sending layer is built later;
-- this table exists now so adding it costs no migration then). One row per digest
-- sent: who got it, what filters produced it, and exactly which signals it included.
create table digest_snapshots (
  id              uuid primary key default gen_random_uuid(),
  sent_at         timestamptz not null default now(),
  recipient_email text,
  filter_params   jsonb,                          -- { since, lenses, significance }
  signal_ids      uuid[] not null default '{}',   -- the signals included in this send
  delivery_status text,                           -- e.g. 'pending' | 'sent' | 'failed'
  created_at      timestamptz not null default now()
);

create index on digest_snapshots (sent_at desc);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table digest_snapshots enable row level security;

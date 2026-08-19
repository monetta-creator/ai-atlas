-- 0001_init.sql — AI Atlas schema (Design Doc v0.2 §6)
-- Orientation, not proof: the model proposes, the human commits. The personal
-- layer (confidence/rationale/priors/positions) is structurally separable from
-- the public map. RLS is enabled with no public policies — all access is
-- server-mediated via the service-role key, which decides public vs. personal.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type domain_t            as enum ('capability','economics','build_out','market');
create type resolvability_t     as enum ('clean','slow','qualitative');
create type lens_t              as enum ('market','economics','social','employment','education','geopolitics','stack');
create type relation_t          as enum ('supports','contradicts','depends_on','organizes');
create type direction_t         as enum ('supports','contradicts','neutral');
create type weight_t            as enum ('high','medium','low');
create type node_t              as enum ('stance','claim','bridge_claim');
create type rationale_target_t  as enum ('stance','claim','bridge_claim','position');
create type extraction_target_t as enum ('claim','bridge_claim','new');
create type trigger_t           as enum ('scheduled','manual','post_commit');
create type extraction_status_t as enum ('pending','accepted','edited','rejected');

-- ---------------------------------------------------------------- helpers
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- confidence stored as a number, displayed as a word
create or replace function conf_label(c numeric) returns text as $$
  select case
    when c is null     then null
    when c < 0.40      then 'thin'
    when c < 0.60      then 'contested'
    when c < 0.80      then 'leaning'
    else                    'settled'
  end;
$$ language sql immutable;

-- ---------------------------------------------------------------- questions
create table questions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text not null unique,
  summary      text,
  primary_lens lens_t,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- stances
create table stances (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  code        text unique,
  title       text not null,
  holder      text,                         -- who actually holds it (steelman)
  summary     text,
  test        text not null,                -- what would move the author off the whole stance
  confidence  numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_label text generated always as (conf_label(confidence)) stored,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- claims (frames live here via is_frame)
create table claims (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  statement   text not null,
  test        text,                          -- the disconfirmer; required unless is_frame
  domain      domain_t,                      -- the single firewall domain
  domain_note text,                          -- preserves seed's raw domain string (e.g. "Economics + Capability")
  resolvability resolvability_t,
  confidence  numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_label text generated always as (conf_label(confidence)) stored,
  is_frame    boolean not null default false,
  reflexive   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint claims_test_required   check (is_frame = true or (test is not null and length(btrim(test)) > 0)),
  constraint claims_domain_required check (is_frame = true or domain is not null)
);

-- ---------------------------------------------------------------- bridge_claims (first-class inter-domain objects)
create table bridge_claims (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  statement   text not null,
  domain_from domain_t not null,
  domain_to   domain_t not null,
  test        text not null,
  resolvability resolvability_t,
  confidence  numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_label text generated always as (conf_label(confidence)) stored,
  reflexive   boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- lenses (claim or bridge_claim)
create table node_lenses (
  id          uuid primary key default gen_random_uuid(),
  target_type node_t not null,               -- claim | bridge_claim
  target_id   uuid not null,
  lens        lens_t not null,
  unique (target_type, target_id, lens)
);

-- ---------------------------------------------------------------- edges (the argument graph)
create table edges (
  id        uuid primary key default gen_random_uuid(),
  from_type node_t not null,
  from_id   uuid not null,
  to_type   node_t not null,
  to_id     uuid not null,
  relation  relation_t not null,
  note      text,
  created_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, relation)
);

-- ---------------------------------------------------------------- sources
create table sources (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  author      text,
  outlet      text,
  url         text,
  published_at date,
  storage_path text,                         -- uploaded PDFs
  raw_text    text,                          -- pasted sources
  domain_tag  domain_t,                      -- suggested by dossier, confirmed by author
  reliability_prior int check (reliability_prior is null or (reliability_prior between 0 and 100)), -- author-set only
  dossier     jsonb,                         -- full structured dossier (audit trail for the prior)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- evidence (claim or bridge_claim)
create table evidence (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references sources(id) on delete cascade,
  target_type node_t not null,               -- claim | bridge_claim
  target_id   uuid not null,
  direction   direction_t not null,
  weight      weight_t not null default 'medium',
  excerpt     text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- cross-cutting positions (personal layer)
create table positions_crosscutting (
  id          uuid primary key default gen_random_uuid(),
  statement   text not null,
  confidence  numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_label text generated always as (conf_label(confidence)) stored,
  private     boolean not null default true, -- hidden in share view
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table position_components (
  id          uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions_crosscutting(id) on delete cascade,
  target_type node_t not null,               -- stance | claim | bridge_claim
  target_id   uuid not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- snapshots (calibration / time-slider)
create table snapshots (
  id        uuid primary key default gen_random_uuid(),
  taken_at  timestamptz not null default now(),
  state     jsonb not null,                  -- claim/bridge/stance/position id -> confidence
  trigger   trigger_t not null default 'manual',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- rationales (append-only audit trail)
create table rationales (
  id            uuid primary key default gen_random_uuid(),
  target_type   rationale_target_t not null,
  target_id     uuid not null,
  old_confidence numeric(3,2),
  new_confidence numeric(3,2),
  reason        text not null,               -- the one-line "why I changed my mind"
  evidence_id   uuid references evidence(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- extraction_queue (transient review state)
create table extraction_queue (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references sources(id) on delete cascade,
  target_type        extraction_target_t not null,
  proposed_target_id uuid,
  proposed_statement text,
  proposed_test      text,
  proposed_direction direction_t,
  proposed_weight    weight_t,
  excerpt            text,
  status             extraction_status_t not null default 'pending',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index on stances(question_id);
create index on claims(domain);
create index on claims(is_frame);
create index on edges(from_type, from_id);
create index on edges(to_type, to_id);
create index on node_lenses(target_type, target_id);
create index on evidence(target_type, target_id);
create index on evidence(source_id);
create index on rationales(target_type, target_id);
create index on position_components(position_id);
create index on extraction_queue(status);

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['questions','stances','claims','bridge_claims','sources','evidence','positions_crosscutting','extraction_queue']
  loop
    execute format('create trigger trg_%s_updated before update on %I for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS (deny-by-default; service role bypasses, all access server-mediated)
do $$
declare t text;
begin
  foreach t in array array['questions','stances','claims','bridge_claims','node_lenses','edges','sources','evidence','positions_crosscutting','position_components','snapshots','rationales','extraction_queue']
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

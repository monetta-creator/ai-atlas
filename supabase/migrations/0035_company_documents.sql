-- 0035_company_documents.sql — retained extracted text of documents about a
-- Scout company (pitch decks, diligence notes, articles). The PDF's text is
-- extracted in the BROWSER (the ingest form's unpdf pattern) and stored here;
-- the file itself is never uploaded or stored. Text is sanitized and capped at
-- 200k chars by the action. origin is check-constrained text, not an enum (the
-- fetched_via precedent: a two-value set does not earn a type).
create table company_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  filename    text not null,
  origin      text not null default 'admin' check (origin in ('admin', 'portal')),
  char_count  int not null,
  text        text not null,
  doc_summary text,
  created_at  timestamptz not null default now()
);
create index on company_documents (company_id, created_at desc);
alter table company_documents enable row level security;

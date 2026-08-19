-- 0032_tickets.sql — the public feedback box: bug reports and feature requests.
--
-- Two dialogs (rail bottom island) let any visitor file a ticket: kind, a short
-- title, free-text body, a required email (admin-only column, never rendered
-- publicly), the page it was filed from, an optional bug severity, and up to
-- three screenshots. Images are stored IN the database (client-side downscaled
-- to ~1600px JPEG before upload, server-capped at 2MB each) because this tool's
-- traffic does not justify object-storage infrastructure; the admin image route
-- serves them gated on isAdmin.
--
-- Status workflow (admin /tickets console): open -> in_progress -> resolved /
-- declined. RLS enabled with no policies like every other table (deny-by-default;
-- the app's role bypasses, all access is server-mediated).

create type ticket_kind_t as enum ('bug', 'feature');
create type ticket_status_t as enum ('open', 'in_progress', 'resolved', 'declined');

create table tickets (
  id uuid primary key default gen_random_uuid(),
  kind ticket_kind_t not null,
  status ticket_status_t not null default 'open',
  title text not null,
  body text not null,
  email text not null,
  severity text,                -- bugs only: cosmetic / annoying / blocking (validated app-side)
  page text,                    -- the path the dialog was opened from
  user_agent text,
  admin_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ticket_images (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  content_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

create index tickets_status_idx on tickets (status, created_at desc);
create index ticket_images_ticket_idx on ticket_images (ticket_id);

create trigger trg_tickets_updated before update on tickets
  for each row execute function set_updated_at();

alter table tickets enable row level security;
alter table ticket_images enable row level security;

-- Signal promotion (2026-09-22): clearing the draft backlog without deleting
-- anything, and a policy that promotes high-significance pipeline drafts on
-- its own after a veto window.
--
-- signals.archive_reason: why a draft was set aside (the bulk cuts and the
-- review sprint write it; archived drafts keep every row, link and candidate).
-- signals.auto_published_at: stamps a draft the promotion sweep published, so
-- policy publishes stay distinguishable from a human click.
--
-- pipeline_prefs gains the policy: auto_publish_high (on/off), the veto window
-- in hours, and auto_publish_from, the moment the policy started. Only drafts
-- created at or after that moment are eligible, so the pre-existing backlog
-- stays a human review, never a surprise bulk publish.

alter table signals add column if not exists archive_reason text;
alter table signals add column if not exists auto_published_at timestamptz;

alter table pipeline_prefs add column if not exists auto_publish_high boolean not null default true;
alter table pipeline_prefs add column if not exists auto_publish_after_hours int not null default 48
  check (auto_publish_after_hours between 1 and 720);
alter table pipeline_prefs add column if not exists auto_publish_from timestamptz not null default now();

insert into pipeline_prefs (id) values (true) on conflict (id) do nothing;

create index if not exists signals_promotion_idx
  on signals (created_at)
  where is_published = false and archived_at is null and origin = 'pipeline' and significance = 'high';

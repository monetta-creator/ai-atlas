import { q, one } from '../db';
import type {
  Ticket, TicketKind, TicketStatus,
  } from '../types';

// ---- Nav queue badges -------------------------------------------------------
// One cheap round trip for the admin nav's live counts: work waiting in an
// in-flight pipeline run, active signal drafts, and the paper review queue.
// Called by Header ONLY for admins, so guests never pay for it.
export async function getNavCounts(): Promise<{ pipeline: number; drafts: number; papers: number; scout: number; tickets: number }> {
  const row = await one<{ pipeline: number; drafts: number; papers: number; scout: number; tickets: number }>(
    `select
       (select count(*) from signal_candidates sc
          join pipeline_runs r on r.id = sc.run_id
         where r.status = 'running' and sc.triage_status = 'pending')::int as pipeline,
       (select count(*) from signals
         where is_published = false and archived_at is null)::int as drafts,
       (select count(*) from papers
         where triage_status = 'kept' and review_status = 'pending')::int as papers,
       (select count(*) from companies where status = 'queued')::int as scout,
       (select count(*) from tickets where status = 'open')::int as tickets`
  );
  return row ?? { pipeline: 0, drafts: 0, papers: 0, scout: 0, tickets: 0 };
}

// ---- Tickets — the public feedback box (migration 0032) ---------------------
// Admin-only readers: `email`, `admin_note`, and `user_agent` never leave an
// admin surface. Images are served by the admin-gated /api/tickets/image route.

export async function getTickets(filter: { kind?: TicketKind; status?: TicketStatus } = {}): Promise<Ticket[]> {
  return q<Ticket>(
    `select t.id, t.kind::text as kind, t.status::text as status, t.title, t.body, t.email,
            t.severity, t.page, t.user_agent, t.admin_note,
            t.resolved_at::text as resolved_at, t.created_at::text as created_at, t.updated_at::text as updated_at,
            coalesce(
              (select array_agg(i.id order by i.created_at) from ticket_images i where i.ticket_id = t.id),
              '{}'
            ) as image_ids
       from tickets t
      where ($1::ticket_kind_t is null or t.kind = $1::ticket_kind_t)
        and ($2::ticket_status_t is null or t.status = $2::ticket_status_t)
      order by (t.status in ('open', 'in_progress')) desc, t.created_at desc
      limit 200`,
    [filter.kind ?? null, filter.status ?? null]
  );
}

export async function getTicketImage(id: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  return one<{ content_type: string; bytes: Buffer }>(
    `select content_type, bytes from ticket_images where id = $1`,
    [id]
  );
}

// One cheap round trip for the lobby's live tile stats. Counts only, guest-safe
// by construction (nothing here touches the personal layer).
interface LobbyStats {
  claims: number;
  signalsPublished: number;
  signalsWeek: number;
  theses: number;
  papersTracked: number;
  threads: number;
}

export async function getLobbyStats(): Promise<LobbyStats> {
  const row = await one<LobbyStats>(
    `select
       (select count(*) from claims where is_frame = false)::int as "claims",
       (select count(*) from signals where is_published)::int as "signalsPublished",
       (select count(*) from signals
         where is_published and published_at >= now() - interval '7 days')::int as "signalsWeek",
       (select count(*) from theses)::int as "theses",
       (select count(*) from papers where review_status = 'tracked')::int as "papersTracked",
       (select count(*) from research_threads)::int as "threads"`
  );
  return row ?? { claims: 0, signalsPublished: 0, signalsWeek: 0, theses: 0, papersTracked: 0, threads: 0 };
}

// The front page's thesis tracker: the latest saved run per standing thesis,
// newest first. Everything here is guest-safe by construction (the pack's stats
// are the public shareable report's own numbers).
export interface ThesisTrackerEntry {
  report_id: string;
  thesis_id: string;
  title: string;
  statement: string;
  generated_at: string;
  matched: number;
  supports: number;
  contradicts: number;
  mixed: number;
}

export async function getLatestThesisReports(limit = 2): Promise<ThesisTrackerEntry[]> {
  return q<ThesisTrackerEntry>(
    `select id as report_id, thesis_id, title, statement,
            generated_at::text as generated_at,
            coalesce((pack->'stats'->>'matched')::int, 0) as matched,
            coalesce((pack->'stats'->'stances'->>'supports')::int, 0) as supports,
            coalesce((pack->'stats'->'stances'->>'contradicts')::int, 0) as contradicts,
            coalesce((pack->'stats'->'stances'->>'mixed')::int, 0) as mixed
       from (
         select distinct on (thesis_id) *
           from thesis_reports
          order by thesis_id, generated_at desc
       ) t
      order by generated_at desc, id
      limit $1`,
    [limit]
  );
}

import { q, one } from '../db';
import type {
  Company, CompanyEvent, CompanyEventWithCompany, ScoutVertical, ScoutRun, ScoutPrefs,
  CompanyDocument,
} from '../types';

// ---- Startup Scout (migration 0034) -----------------------------------------
// The acquisition-target funnel. Leak discipline (the research-portal pattern):
// the agent layer (verdict/scores/reason), review notes, provenance, and any
// non-tracked company are admin-only, and the guest getters simply never SELECT
// those columns, so nothing private reaches the RSC payload. A public "pursue"
// chip on a named startup would disclose M&A intent.

const COMPANY_PUBLIC_COLUMNS = `
  id, name, domain, url, vertical, one_liner, ai_tech, founded_year, stage,
  funding_note, hq, status, origin, created_at, updated_at`;
const COMPANY_ADMIN_COLUMNS = `${COMPANY_PUBLIC_COLUMNS},
  review_note, reviewed_at::text as reviewed_at,
  agent_verdict, agent_reason, agent_confidence, agent_scores, agent_at::text as agent_at,
  fetched_via, run_id, found_url`;

export async function getScoutVerticals(personal = false): Promise<ScoutVertical[]> {
  return q<ScoutVertical>(
    `select v.slug, v.name, v.description, v.search_queries, v.active,
            (select count(*)::int from companies c where c.vertical = v.slug and c.status = 'tracked') as tracked_count
            ${personal ? `, (select count(*)::int from companies c where c.vertical = v.slug and c.status = 'queued') as queued_count` : ''}
       from scout_verticals v
      order by v.name`
  );
}

// The public monitor: tracked companies only (the watchlist), newest decision first.
export async function getTrackedCompanies(personal = false): Promise<Company[]> {
  return q<Company>(
    `select ${personal ? COMPANY_ADMIN_COLUMNS : COMPANY_PUBLIC_COLUMNS}
       from companies where status = 'tracked'
      order by reviewed_at desc nulls last, created_at desc`
  );
}

// Three viewer tiers. Admin: everything, any status. Portal (team key): PUBLIC
// columns for tracked + queued companies (their adds land in the queue, so they
// must see them; the agent layer stays admin-only always). Guest: PUBLIC
// columns, tracked only; anything else resolves to null (404).
export async function getCompany(
  id: string,
  viewer: { admin: boolean; portal: boolean }
): Promise<Company | null> {
  if (viewer.admin) {
    return one<Company>(
      `select ${COMPANY_ADMIN_COLUMNS}, raw_content, dossier from companies where id = $1`,
      [id]
    );
  }
  return one<Company>(
    `select ${COMPANY_PUBLIC_COLUMNS} from companies
      where id = $1 and status = any($2::company_status_t[])`,
    [id, viewer.portal ? ['tracked', 'queued'] : ['tracked']]
  );
}

// The portal's "In the review queue" strip: PUBLIC columns only, so the agent
// layer never reaches a keyholder's payload.
export async function getQueuedCompaniesPublic(limit = 50): Promise<Company[]> {
  return q<Company>(
    `select ${COMPANY_PUBLIC_COLUMNS} from companies
      where status = 'queued' order by created_at desc, id limit $1`,
    [limit]
  );
}

export async function getCompanyEvents(companyId: string): Promise<CompanyEvent[]> {
  return q<CompanyEvent>(
    `select id, company_id, to_char(event_date, 'YYYY-MM-DD') as event_date,
            kind, title, url, note, signal_id, created_at
       from company_events where company_id = $1
      order by event_date desc, created_at desc`,
    [companyId]
  );
}

// The public monitor's recent-activity strip: events on tracked companies only.
export async function getRecentCompanyEvents(limit = 10): Promise<CompanyEventWithCompany[]> {
  return q<CompanyEventWithCompany>(
    `select e.id, e.company_id, to_char(e.event_date, 'YYYY-MM-DD') as event_date,
            e.kind, e.title, e.url, e.note, e.signal_id, e.created_at,
            c.name as company_name, c.status as company_status
       from company_events e
       join companies c on c.id = e.company_id
      where c.status = 'tracked'
      order by e.event_date desc, e.created_at desc
      limit $1`,
    [limit]
  );
}

// The review queue (admin): discovered companies awaiting the human decision.
export async function getScoutQueue(limit = 200): Promise<Company[]> {
  return q<Company>(
    `select ${COMPANY_ADMIN_COLUMNS} from companies
      where status = 'queued'
      order by created_at desc
      limit $1`,
    [limit]
  );
}

export async function getScoutRuns(limit = 12): Promise<ScoutRun[]> {
  return q<ScoutRun>(
    `select id, triggered_at, status, step, found_count, new_count, error, created_at, updated_at
       from scout_runs order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getScoutPrefs(): Promise<ScoutPrefs> {
  const row = await one<ScoutPrefs>(`select steering, rubric from scout_prefs where id = true`);
  return row ?? { steering: null, rubric: null };
}

// Retained company documents (migration 0035). List reads omit the text column
// (it can be 200k chars); the text getter serves re-extraction only.
export async function getCompanyDocuments(companyId: string): Promise<CompanyDocument[]> {
  return q<CompanyDocument>(
    `select id, company_id, filename, origin, char_count, doc_summary,
            to_char(created_at, 'YYYY-MM-DD') as created_at
       from company_documents where company_id = $1
      order by created_at desc, id`,
    [companyId]
  );
}

export async function getCompanyDocumentText(id: string): Promise<{ company_id: string; text: string } | null> {
  return one<{ company_id: string; text: string }>(
    `select company_id::text as company_id, text from company_documents where id = $1`,
    [id]
  );
}

// Every queued company id, for the agent panel's chunked processing loop.
// Re-runs deliberately include already-scored rows so fresh steering re-scores.
export async function getScoutQueueIds(limit = 400): Promise<{ id: string; name: string }[]> {
  return q(`select id::text as id, name from companies where status = 'queued' order by created_at limit $1`, [limit]);
}

export async function getScoutAgentSummary(): Promise<Record<string, number>> {
  const rows = await q<{ verdict: string | null; n: string }>(
    `select agent_verdict::text as verdict, count(*)::text as n
       from companies where status = 'queued' group by agent_verdict`
  );
  const out: Record<string, number> = { pursue: 0, watch: 0, pass: 0, none: 0 };
  for (const r of rows) out[r.verdict ?? 'none'] = Number(r.n);
  return out;
}

// The admin's revealed preferences on companies, digested for the agent prompt.
export async function getScoutTasteDigest(): Promise<{
  tracked: { name: string; note: string | null }[];
  dismissed: string[];
}> {
  const [tracked, dismissed] = await Promise.all([
    q<{ name: string; note: string | null }>(
      `select name, review_note as note from companies
        where status = 'tracked' order by reviewed_at desc nulls last limit 25`
    ),
    q<{ name: string }>(
      `select name from companies where status = 'dismissed'
        order by reviewed_at desc nulls last limit 25`
    ),
  ]);
  return { tracked, dismissed: dismissed.map((r) => r.name) };
}

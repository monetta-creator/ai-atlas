import { one, exec, withTx } from '../db';
import type {
  CompanyStatus, CompanyStage, CompanyEventKind, ScoutVerdict, ScoutScores,
} from '../types';
import { sanitizeText, domainOf } from '../pipeline/web';
import { companyNameKey, parseStageHint, parseFoundedHint, mergeDossier } from '../scout/core';
import type { ScoutDossier } from '../scout/core';

// ---- Startup Scout (migration 0034) -----------------------------------------
// Companies follow the papers model: the row is both library and funnel state,
// deduped GLOBALLY by domain and normalized name. The review write below is the
// only path that changes status (the human gate on the acquisition funnel).

export async function createCompany(input: {
  name: string;
  url?: string | null;
  vertical: string;
  one_liner?: string | null;
  ai_tech?: string | null;
  founded_year?: number | null;
  stage?: CompanyStage;
  funding_note?: string | null;
  hq?: string | null;
  origin?: 'discovery' | 'manual';
  run_id?: string | null;
  found_url?: string | null;
}): Promise<{ id: string; existed: boolean }> {
  const domain = input.url ? domainOf(input.url) || null : null;
  const existing = await one<{ id: string }>(
    `select id from companies
      where (($1::text is not null and domain = $1) or name_key = $2) limit 1`,
    [domain, companyNameKey(input.name)]
  );
  if (existing) return { id: existing.id, existed: true };
  const row = await one<{ id: string }>(
    `insert into companies
       (name, domain, url, vertical, one_liner, ai_tech, founded_year, stage,
        funding_note, hq, origin, run_id, found_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      sanitizeText(input.name).slice(0, 200), domain, input.url ?? null, input.vertical,
      input.one_liner ? sanitizeText(input.one_liner) : null,
      input.ai_tech ? sanitizeText(input.ai_tech) : null,
      input.founded_year ?? null, input.stage ?? 'unknown',
      input.funding_note ? sanitizeText(input.funding_note) : null,
      input.hq ? sanitizeText(input.hq) : null,
      input.origin ?? 'manual', input.run_id ?? null, input.found_url ?? null,
    ]
  );
  return { id: row!.id, existed: false };
}

// The review decision + its why. Tracking requires a note — enforced in the
// action; this just writes. Reversible: any status can move to any other.
export async function reviewCompany(id: string, status: CompanyStatus, note: string | null): Promise<void> {
  await exec(
    `update companies set status = $1, review_note = coalesce($2, review_note),
            reviewed_at = now(), updated_at = now()
      where id = $3`,
    [status, note, id]
  );
}

// Admin fact edits from the profile page (the human's text always wins; the
// future enrichment leg fills only nulls and never touches an edited field).
export async function updateCompanyFacts(id: string, input: {
  one_liner?: string | null;
  ai_tech?: string | null;
  founded_year?: number | null;
  stage?: CompanyStage;
  funding_note?: string | null;
  hq?: string | null;
}): Promise<void> {
  await exec(
    `update companies
        set one_liner = $1, ai_tech = $2, founded_year = $3, stage = $4,
            funding_note = $5, hq = $6, updated_at = now()
      where id = $7`,
    [
      input.one_liner ? sanitizeText(input.one_liner) : null,
      input.ai_tech ? sanitizeText(input.ai_tech) : null,
      input.founded_year ?? null, input.stage ?? 'unknown',
      input.funding_note ? sanitizeText(input.funding_note) : null,
      input.hq ? sanitizeText(input.hq) : null,
      id,
    ]
  );
}

export async function createCompanyEvent(input: {
  company_id: string;
  event_date: string;   // 'YYYY-MM-DD'
  kind: CompanyEventKind;
  title: string;
  url?: string | null;
  note?: string | null;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into company_events (company_id, event_date, kind, title, url, note)
     values ($1, $2::date, $3, $4, $5, $6) returning id`,
    [
      input.company_id, input.event_date, input.kind,
      sanitizeText(input.title).slice(0, 300), input.url ?? null,
      input.note ? sanitizeText(input.note) : null,
    ]
  );
  return row!.id;
}

export async function deleteCompanyEvent(id: string): Promise<void> {
  await exec(`delete from company_events where id = $1`, [id]);
}

export async function upsertVertical(input: {
  slug: string;
  name: string;
  description?: string | null;
  search_queries?: string[];
}): Promise<void> {
  await exec(
    `insert into scout_verticals (slug, name, description, search_queries)
     values ($1, $2, $3, $4)
     on conflict (slug) do update
       set name = excluded.name, description = excluded.description,
           search_queries = case when array_length(excluded.search_queries, 1) is null
                            then scout_verticals.search_queries else excluded.search_queries end`,
    [input.slug, sanitizeText(input.name).slice(0, 80),
     input.description ? sanitizeText(input.description) : null,
     input.search_queries ?? []]
  );
}

export async function setVerticalActive(slug: string, active: boolean): Promise<void> {
  await exec(`update scout_verticals set active = $2 where slug = $1`, [slug, active]);
}

// ---- Scout enrichment (phase 4) ---------------------------------------------

export async function setCompanyRawContent(id: string, text: string, via: string): Promise<void> {
  await exec(
    `update companies set raw_content = $2, fetched_via = $3, updated_at = now() where id = $1`,
    [id, sanitizeText(text), via]
  );
}

interface CompanyFactsFill {
  one_liner: string | null;
  ai_tech: string | null;
  founded_year: number | null;
  stage: CompanyStage;
  funding_note: string | null;
  hq: string | null;
}

// Fill-only-null on the fact columns (the human's edits always win; stage uses
// 'unknown' as its null sentinel). Returns which columns were actually filled,
// for the research panel's log line.
export async function fillCompanyFacts(id: string, input: CompanyFactsFill): Promise<string[]> {
  return withTx(async (c) => {
    const before = await c.query(
      `select one_liner, ai_tech, founded_year, stage, funding_note, hq from companies where id = $1`,
      [id]
    );
    if (!before.rowCount) return [];
    const b = before.rows[0];
    await c.query(
      `update companies
          set one_liner = coalesce(one_liner, $2),
              ai_tech = coalesce(ai_tech, $3),
              founded_year = coalesce(founded_year, $4),
              stage = case when stage = 'unknown' then $5::company_stage_t else stage end,
              funding_note = coalesce(funding_note, $6),
              hq = coalesce(hq, $7),
              updated_at = now()
        where id = $1`,
      [
        id,
        input.one_liner ? sanitizeText(input.one_liner) : null,
        input.ai_tech ? sanitizeText(input.ai_tech) : null,
        input.founded_year,
        input.stage,
        input.funding_note ? sanitizeText(input.funding_note) : null,
        input.hq ? sanitizeText(input.hq) : null,
      ]
    );
    const filled: string[] = [];
    if (!b.one_liner && input.one_liner) filled.push('one-liner');
    if (!b.ai_tech && input.ai_tech) filled.push('AI tech');
    if (!b.founded_year && input.founded_year) filled.push('founded');
    if (b.stage === 'unknown' && input.stage !== 'unknown') filled.push('stage');
    if (!b.funding_note && input.funding_note) filled.push('funding');
    if (!b.hq && input.hq) filled.push('hq');
    return filled;
  });
}

// The dossier has THREE writers (homepage enrich, the intel sweep, document
// extraction), so it merges monotonically (lib/scout/core.ts mergeDossier)
// instead of being replaced wholesale: no tool can erase another's finds.
export async function mergeCompanyDossier(
  id: string,
  patch: { summary: string | null; products: string[]; customers: string[]; sources: string[]; updated_by: ScoutDossier['updated_by'] }
): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query(`select dossier from companies where id = $1 for update`, [id]);
    if (!res.rowCount) return;
    const merged = mergeDossier(res.rows[0].dossier ?? null, patch, new Date().toISOString());
    await c.query(
      `update companies set dossier = $2::jsonb, updated_at = now() where id = $1`,
      [id, JSON.stringify(merged)]
    );
  });
}

// The homepage-enrichment writer, composed of the two halves above.
export async function updateCompanyEnrichment(id: string, input: CompanyFactsFill & {
  dossier: { summary: string | null; products: string[]; customers: string[]; sources: string[]; updated_by: ScoutDossier['updated_by'] };
}): Promise<string[]> {
  const filled = await fillCompanyFacts(id, input);
  await mergeCompanyDossier(id, input.dossier);
  return filled;
}

// ---- Scout documents (migration 0035) ---------------------------------------

export async function createCompanyDocument(input: {
  company_id: string;
  filename: string;
  origin: 'admin' | 'portal';
  text: string;
}): Promise<string> {
  const text = sanitizeText(input.text).slice(0, 200_000);
  const row = await one<{ id: string }>(
    `insert into company_documents (company_id, filename, origin, char_count, text)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.company_id, sanitizeText(input.filename).slice(0, 200), input.origin, [...text].length, text]
  );
  return row!.id;
}

export async function setDocumentSummary(id: string, summary: string | null): Promise<void> {
  await exec(`update company_documents set doc_summary = $2 where id = $1`, [id, summary]);
}

export async function deleteCompanyDocument(id: string): Promise<void> {
  await exec(`delete from company_documents where id = $1`, [id]);
}

// ---- Scout scoring agent (phase 3) ------------------------------------------
// Recommendations are advisory columns on companies; reviewCompany above stays
// the only path that changes status (human commits, per row or in bulk).

export async function setScoutRecommendations(rows: {
  id: string;
  verdict: ScoutVerdict;
  confidence: number;
  reason: string;
  scores: ScoutScores;
}[]): Promise<number> {
  const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
  return withTx(async (c) => {
    let n = 0;
    for (const r of rows) {
      const scores: ScoutScores = {
        ai_depth: clamp5(r.scores?.ai_depth),
        acquisition_fit: clamp5(r.scores?.acquisition_fit),
        traction: clamp5(r.scores?.traction),
        team: clamp5(r.scores?.team),
        integration_cost: clamp5(r.scores?.integration_cost),
      };
      const res = await c.query(
        `update companies
            set agent_verdict = $2, agent_reason = $3, agent_confidence = $4,
                agent_scores = $5::jsonb, agent_at = now(), updated_at = now()
          where id = $1 and status = 'queued'`,
        [
          r.id, r.verdict, r.reason,
          Math.max(0, Math.min(100, Math.round(r.confidence))),
          JSON.stringify(scores),
        ]
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

export async function saveScoutPrefs(steering: string | null, rubric: string | null): Promise<void> {
  await exec(
    `insert into scout_prefs (id, steering, rubric) values (true, $1, $2)
     on conflict (id) do update
       set steering = excluded.steering, rubric = excluded.rubric, updated_at = now()`,
    [steering, rubric]
  );
}

// Bulk accept of agent verdicts: pursue tracks (the agent's reason becomes the
// review note, editable later), pass dismisses. Watch stays queued for per-row
// judgment. The SAME review write as a manual decision.
export async function acceptScoutRecommendations(verdict: 'pursue' | 'pass'): Promise<string[]> {
  const status = verdict === 'pursue' ? 'tracked' : 'dismissed';
  return withTx(async (c) => {
    const res = await c.query(
      `update companies
          set status = $1,
              review_note = case when $1 = 'tracked'
                then coalesce(nullif(agent_reason, ''), 'Tracked on the scout agent''s recommendation.')
                else review_note end,
              reviewed_at = now(), updated_at = now()
        where status = 'queued' and agent_verdict = $2
        returning id`,
      [status, verdict]
    );
    return res.rows.map((r) => r.id as string);
  });
}

// ---- Scout discovery (phase 2) ----------------------------------------------

export async function createScoutRun(): Promise<string> {
  const row = await one<{ id: string }>(`insert into scout_runs default values returning id`);
  return row!.id;
}

export async function completeScoutRun(id: string): Promise<void> {
  await exec(
    `update scout_runs set status = 'completed', step = 'complete', updated_at = now() where id = $1`,
    [id]
  );
}

export async function failScoutRun(id: string, error: string): Promise<void> {
  await exec(
    `update scout_runs set status = 'failed', error = $2, updated_at = now() where id = $1`,
    [id, error.slice(0, 500)]
  );
}

export async function bumpScoutRunCounts(id: string, found: number, inserted: number): Promise<void> {
  await exec(
    `update scout_runs set found_count = found_count + $2, new_count = new_count + $3, updated_at = now()
      where id = $1`,
    [id, found, inserted]
  );
}

// Discovery inserts: dedupe GLOBALLY (any status — a dismissed company is never
// re-queued) by domain and normalized name, and within the batch itself, since
// one run can surface the same company under two verticals. All-or-nothing per
// batch via withTx so a retried batch never half-inserts.
export async function insertCompanies(
  runId: string | null,   // null for run-less inserts (the competitor scan)
  vertical: string,
  companies: {
    name: string; url: string; one_liner: string; stage_hint: string;
    founded_hint: string; funding_note: string; found_url: string;
  }[]
): Promise<{ found: number; inserted: number }> {
  if (!companies.length) return { found: 0, inserted: 0 };
  return withTx(async (c) => {
    let inserted = 0;
    const seenInBatch = new Set<string>();
    for (const raw of companies) {
      const domain = raw.url ? domainOf(raw.url) || null : null;
      const nameKey = companyNameKey(raw.name);
      if (!nameKey) continue;
      const batchKey = domain ?? nameKey;
      if (seenInBatch.has(batchKey) || seenInBatch.has(nameKey)) continue;
      seenInBatch.add(batchKey);
      seenInBatch.add(nameKey);
      const existing = await c.query(
        `select id from companies
          where (($1::text is not null and domain = $1) or name_key = $2) limit 1`,
        [domain, nameKey]
      );
      if (existing.rowCount) continue;
      await c.query(
        `insert into companies
           (name, domain, url, vertical, one_liner, founded_year, stage, funding_note,
            origin, run_id, found_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'discovery', $9, $10)`,
        [
          sanitizeText(raw.name).slice(0, 200), domain, raw.url || null, vertical,
          raw.one_liner ? sanitizeText(raw.one_liner) : null,
          parseFoundedHint(raw.founded_hint), parseStageHint(raw.stage_hint),
          raw.funding_note ? sanitizeText(raw.funding_note) : null,
          runId, raw.found_url || null,
        ]
      );
      inserted += 1;
    }
    return { found: companies.length, inserted };
  });
}

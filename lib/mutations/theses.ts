import { q, one, exec } from '../db';
import type {
  ArgumentGapScan,
  } from '../types';

// ---- Theses + thesis reports (migration 0027) --------------------------------
// The thesis writers are the only path that persists a claim mapping, and they
// REFUSE a dangling code (edges-without-FK discipline, same as createClaimWithEdges):
// every code must name a live non-frame claim or a bridge-claim at write time.
// Frames are quarantined from evidence, so they are not valid thesis targets.

async function assertThesisCodesResolve(codes: string[]): Promise<void> {
  if (!codes.length) return;
  const rows = await q<{ code: string }>(
    `select code from claims where code = any($1::text[]) and is_frame = false
     union all
     select code from bridge_claims where code = any($1::text[])`,
    [codes]
  );
  const live = new Set(rows.map((r) => r.code));
  const dangling = codes.filter((c) => !live.has(c));
  if (dangling.length) throw new Error(`Unknown claim code${dangling.length > 1 ? 's' : ''}: ${dangling.join(', ')}`);
}

export async function createThesis(input: {
  statement: string;
  claim_codes: string[];
  mapping_note?: string | null;
}): Promise<string> {
  await assertThesisCodesResolve(input.claim_codes);
  const row = await one<{ id: string }>(
    `insert into theses (statement, claim_codes, mapping_note)
     values ($1, $2::text[], $3) returning id`,
    [input.statement, input.claim_codes, input.mapping_note || null]
  );
  return row!.id;
}

export async function updateThesis(
  id: string,
  input: { statement: string; claim_codes: string[]; mapping_note?: string | null }
): Promise<void> {
  await assertThesisCodesResolve(input.claim_codes);
  await exec(
    `update theses set statement = $2, claim_codes = $3::text[], mapping_note = $4 where id = $1`,
    [id, input.statement, input.claim_codes, input.mapping_note || null]
  );
}

// Persist (or clear) a thesis's gap scan (migration 0036; the per-thesis analogue
// of saveArgumentGapScan). An empty scan clears the column.
export async function saveThesisGapScan(id: string, scan: ArgumentGapScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`update theses set gap_scan = null where id = $1`, [id]);
    return;
  }
  await exec(`update theses set gap_scan = $2::jsonb where id = $1`, [id, JSON.stringify(scan)]);
}

// Append one code to a thesis's mapping (the create-from-thesis-gap loop closure:
// the human submitted the authoring form from THIS thesis's scan). Fill-only:
// no-op when the code is already mapped; refuses a dangling code like the other
// thesis writers.
export async function appendThesisCode(id: string, code: string): Promise<void> {
  await assertThesisCodesResolve([code]);
  await exec(
    `update theses set claim_codes = array_append(claim_codes, $2)
      where id = $1 and not (claim_codes @> array[$2]::text[])`,
    [id, code]
  );
}

export async function setThesisStatus(id: string, status: 'active' | 'archived'): Promise<void> {
  await exec(`update theses set status = $2::thesis_status_t where id = $1`, [id, status]);
}

export async function deleteThesis(id: string): Promise<void> {
  await exec(`delete from theses where id = $1`, [id]);   // reports cascade
}

// A thesis report is an immutable run: always an insert (a re-run is a NEW row so
// the delta chain stays honest). The caller (saveThesisReportAction) sanitizes and
// citation-gates the narrative and re-derives signal_ids from the pack.
export async function saveThesisReport(input: {
  thesis_id: string;
  title: string;
  statement: string;
  pack: unknown;
  narrative: unknown;
  signal_ids: string[];
  generated_at: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into thesis_reports (thesis_id, title, statement, pack, narrative, signal_ids, generated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::uuid[], $7::timestamptz)
     returning id`,
    [
      input.thesis_id, input.title, input.statement,
      JSON.stringify(input.pack), JSON.stringify(input.narrative),
      input.signal_ids, input.generated_at,
    ]
  );
  return row!.id;
}

export async function deleteThesisReport(id: string): Promise<void> {
  await exec(`delete from thesis_reports where id = $1`, [id]);
}

import { one, exec } from '../db';
import type {
  ArgumentGapScan,
  } from '../types';

// ---- Hypothesis reports + gap scans ------------------------------------------

// Persist (or clear) a hypothesis's gap scan (the per-hypothesis analogue of
// saveArgumentGapScan). An empty scan clears the column.
export async function saveHypothesisGapScan(id: string, scan: ArgumentGapScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`update hypotheses set gap_scan = null where id = $1`, [id]);
    return;
  }
  await exec(`update hypotheses set gap_scan = $2::jsonb where id = $1`, [id, JSON.stringify(scan)]);
}

// A hypothesis report is an immutable run: always an insert (a re-run is a NEW
// row so the delta chain stays honest). The caller sanitizes and citation-gates
// the narrative and re-derives signal_ids from the pack.
export async function saveHypothesisReport(input: {
  hypothesis_id: string;
  title: string;
  statement: string;
  pack: unknown;
  narrative: unknown;
  signal_ids: string[];
  generated_at: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into hypothesis_reports (hypothesis_id, title, statement, pack, narrative, signal_ids, generated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::uuid[], $7::timestamptz)
     returning id`,
    [
      input.hypothesis_id, input.title, input.statement,
      JSON.stringify(input.pack), JSON.stringify(input.narrative),
      input.signal_ids, input.generated_at,
    ]
  );
  return row!.id;
}

export async function deleteHypothesisReport(id: string): Promise<void> {
  await exec(`delete from hypothesis_reports where id = $1`, [id]);
}

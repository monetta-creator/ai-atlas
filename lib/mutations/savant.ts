import { exec, one, q } from '../db';
import type { Hypothesis, HypothesisUpdate, NotebookKind, SavantPrefs } from '../savant/types';

// ---- Savant writers (migration 0068) ---------------------------------------
// The notebook is append-only with a per-day dedupe key; the hypotheses
// ledger is Savant's memory; the prefs singleton is the console's.

export interface NotebookEntry {
  kind: NotebookKind;
  key: string;
  payload: unknown;
}

// Upsert a day's entries in one statement: the same key twice in a day
// keeps the newest payload, so a re-run of the pass is idempotent.
export async function appendNotebook(weekEnd: string, day: string, entries: NotebookEntry[]): Promise<number> {
  if (!entries.length) return 0;
  // One statement cannot upsert the same (kind, key) twice: keep the last.
  const byKey = new Map<string, NotebookEntry>();
  for (const e of entries) byKey.set(`${e.kind}\u0000${e.key.slice(0, 300)}`, e);
  entries = [...byKey.values()];
  const kinds = entries.map((e) => e.kind);
  const keys = entries.map((e) => e.key.slice(0, 300));
  const payloads = entries.map((e) => JSON.stringify(e.payload));
  const rows = await q<{ id: string }>(
    `insert into savant_notebook (week_end, day, kind, key, payload)
     select $1::date, $2::date, k.kind, k.key, k.payload::jsonb
       from unnest($3::text[], $4::text[], $5::text[]) as k(kind, key, payload)
     on conflict (week_end, day, kind, key) do update set payload = excluded.payload
     returning id`,
    [weekEnd, day, kinds, keys, payloads]
  );
  return rows.length;
}

export async function clearNotebookDayKind(weekEnd: string, day: string, kind: NotebookKind): Promise<void> {
  await exec(`delete from savant_notebook where week_end = $1::date and day = $2::date and kind = $3`, [weekEnd, day, kind]);
}

export async function insertHypothesis(input: {
  statement: string;
  question_slug: string | null;
  posed_week: string;
  what_would_settle: string[];
  watch: string[];
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into savant_hypotheses (statement, question_slug, posed_week, what_would_settle, watch)
     values ($1, $2, $3::date, $4::text[], $5::text[]) returning id::text as id`,
    [input.statement.slice(0, 600), input.question_slug, input.posed_week, input.what_would_settle.slice(0, 6), input.watch.slice(0, 6)]
  );
  return row!.id;
}

// Friday appends this week's reading of an open hypothesis and moves its
// status; a verdict closes it.
export async function updateHypothesis(
  id: string,
  update: HypothesisUpdate,
  status: Hypothesis['status'],
  verdict: string | null = null
): Promise<void> {
  await exec(
    `update savant_hypotheses
        set updates = updates || $2::jsonb,
            status = $3,
            verdict = coalesce($4, verdict)
      where id = $1`,
    [id, JSON.stringify([update]), status, verdict]
  );
}

export async function setSavantPrefs(patch: Partial<SavantPrefs>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.enabled !== undefined) push('enabled', patch.enabled);
  if (patch.writer_model !== undefined) push('writer_model', patch.writer_model);
  if (patch.editor_model !== undefined) push('editor_model', patch.editor_model);
  if (patch.notebook_model !== undefined) push('notebook_model', patch.notebook_model);
  if (patch.editor_name !== undefined) push('editor_name', patch.editor_name);
  if (patch.lead_rotation !== undefined) push('lead_rotation', patch.lead_rotation);
  if (patch.lead_override !== undefined) push('lead_override', patch.lead_override);
  if (patch.email_enabled !== undefined) push('email_enabled', patch.email_enabled);
  if (!sets.length) return;
  await exec(`update savant_prefs set ${sets.join(', ')} where id = true`, vals);
}

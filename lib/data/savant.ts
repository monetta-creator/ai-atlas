import { q, one } from '../db';
import type { Hypothesis, NotebookKind, NotebookRow, SavantPrefs, SelfCompany } from '../savant/types';

// ---- Savant (migration 0068) ------------------------------------------------
// Reads for the notebook, the hypotheses ledger, the prefs singleton and the
// reader organization. Admin/console reads and the Friday run share these;
// nothing here reaches a guest page directly (the issue's pack is built
// guest-safe by construction in Phase 2).

export async function getSavantPrefs(): Promise<SavantPrefs> {
  const row = await one<SavantPrefs>(
    `select enabled, writer_model, editor_model, notebook_model, editor_name, lead_rotation, lead_override, email_enabled
       from savant_prefs where id = true`
  );
  return (
    row ?? {
      enabled: true,
      writer_model: 'claude-sonnet-4-6',
      editor_model: 'claude-sonnet-4-6',
      notebook_model: 'z-ai/glm-5.3-flash',
      editor_name: 'the Desk Editor',
      lead_rotation: ['capability', 'build-out', 'unit-economics', 'mispricing', 'rent', 'geopolitics', 'labor'],
      lead_override: null,
      email_enabled: false,
    }
  );
}

const NOTEBOOK_ROW = `id::text as id, week_end::text as week_end, day::text as day, kind, key, payload, created_at::text as created_at`;

export async function getNotebook(weekEnd: string, kinds?: NotebookKind[]): Promise<NotebookRow[]> {
  return q<NotebookRow>(
    `select ${NOTEBOOK_ROW} from savant_notebook
      where week_end = $1::date and ($2::text[] is null or kind = any($2))
      order by day, kind, created_at`,
    [weekEnd, kinds ?? null]
  );
}

export async function getNotebookDay(weekEnd: string, day: string): Promise<NotebookRow[]> {
  return q<NotebookRow>(
    `select ${NOTEBOOK_ROW} from savant_notebook
      where week_end = $1::date and day = $2::date
      order by kind, created_at`,
    [weekEnd, day]
  );
}

export async function getNotebookWeeks(limit = 12): Promise<{ week_end: string; rows: number; days: number }[]> {
  return q<{ week_end: string; rows: number; days: number }>(
    `select week_end::text as week_end, count(*)::int as rows, count(distinct day)::int as days
       from savant_notebook group by week_end order by week_end desc limit $1`,
    [Math.max(1, Math.min(52, limit))]
  );
}

const HYPOTHESIS_ROW = `id::text as id, statement, question_slug, posed_week::text as posed_week, status, verdict,
  what_would_settle, watch, updates`;

export async function getOpenHypotheses(): Promise<Hypothesis[]> {
  return q<Hypothesis>(
    `select ${HYPOTHESIS_ROW} from savant_hypotheses where status <> 'closed' order by posed_week desc`
  );
}

export async function getHypotheses(limit = 40): Promise<Hypothesis[]> {
  return q<Hypothesis>(
    `select ${HYPOTHESIS_ROW} from savant_hypotheses order by posed_week desc, created_at desc limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
}

// The reader organization: the registry's `self` row, public fields only.
// Null when the registry has none (a fresh install); Savant then writes for a
// generic banking reader.
export async function getSelfCompany(): Promise<SelfCompany | null> {
  return one<SelfCompany>(
    `select slug, name, public_blurb from intel_companies where tier = 'self' and active order by slug limit 1`
  );
}

// Company names + aliases, for the teaser scrub (Phase 2) and for the
// notebook's company labels. Private registry: never rendered to guests.
export async function getCompanyNameMap(): Promise<Map<string, string>> {
  const rows = await q<{ slug: string; name: string }>(`select slug, name from intel_companies where active`);
  return new Map(rows.map((r) => [r.slug, r.name]));
}

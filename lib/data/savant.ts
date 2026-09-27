import { q, one } from '../db';
import type { Hypothesis, NotebookKind, NotebookRow, SavantPrefs, SelfCompany } from '../savant/types';
import type { RateTable } from '../savant/cost-model';

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
// generic banking reader. `public_profile` (mig 0076: {sentences: [{text,
// record_ids}]}) and the latest 12 self_timeline events are resolved against
// self_record so every sentence and event carries its cited public urls
// rather than bare ids; a record no longer present just drops from the list.
export async function getSelfCompany(): Promise<SelfCompany | null> {
  const row = await one<{ slug: string; name: string; public_blurb: string | null; public_profile: { sentences?: { text: string; record_ids: string[] }[] } | null }>(
    `select slug, name, public_blurb, public_profile from intel_companies where tier = 'self' and active order by slug limit 1`
  );
  if (!row) return null;

  const [timelineRows, recordRows] = await Promise.all([
    q<{ event_date: string; headline: string; record_ids: string[] }>(
      `select event_date::text as event_date, headline, record_ids
         from self_timeline where company_slug = $1
         order by event_date desc limit 12`,
      [row.slug]
    ),
    // Every record for the citation gate (allowlist.ts): a sentence can then
    // link a public record neither the profile nor the recent timeline has
    // picked up yet.
    q<{ id: string; url: string }>(`select id::text as id, url from self_record where company_slug = $1`, [row.slug]),
  ]);

  const sentences = row.public_profile?.sentences ?? [];
  const urlById = new Map<string, string>(recordRows.map((r) => [r.id, r.url]));
  const hrefsFor = (ids: string[] | null | undefined): string[] =>
    (ids ?? []).map((id) => urlById.get(id)).filter((u): u is string => Boolean(u));

  return {
    slug: row.slug,
    name: row.name,
    public_blurb: row.public_blurb,
    profile: sentences.map((s) => ({ text: s.text, hrefs: hrefsFor(s.record_ids) })),
    timeline: timelineRows.map((t) => ({ date: t.event_date, headline: t.headline, hrefs: hrefsFor(t.record_ids) })),
    recordUrls: recordRows.map((r) => r.url),
  };
}

// Company names + aliases, for the teaser scrub (Phase 2) and for the
// notebook's company labels. Private registry: never rendered to guests.
export async function getCompanyNameMap(): Promise<Map<string, string>> {
  const rows = await q<{ slug: string; name: string }>(`select slug, name from intel_companies where active`);
  return new Map(rows.map((r) => [r.slug, r.name]));
}

// This issue week's spend: every savant_* feature call stamped with this
// week_end in metadata (the notebook legs and the Friday issue legs alike).
// Mirrors checkSavantBudget's own sum (lib/savant/budget.ts) for the ops
// board, which has no reason to import the budget module's guard logic.
export async function getSavantWeekSpend(weekEnd: string): Promise<number> {
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::float8 as usd from ai_cost_log
      where feature like 'savant_%' and metadata->>'week_end' = $1`,
    [weekEnd]
  );
  return row?.usd ?? 0;
}

// The live rate cards for the prefs form's cost estimate: USD per million
// tokens by model id (numeric arrives as a number via lib/db's type parser).
export async function getModelRates(): Promise<RateTable> {
  const rows = await q<{ model: string; input: number; output: number; cache_read: number }>(
    `select model, input_per_mtok as input, output_per_mtok as output, cache_read_per_mtok as cache_read from ai_rate_cards`
  );
  const out: RateTable = {};
  for (const r of rows) out[r.model] = { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read) };
  return out;
}

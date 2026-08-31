import { one, exec } from '../db';
import type {
  Report, } from '../types';

// ---- Saved reports (persistence) -------------------------------------------
// Upsert: with an id, update in place (updated_at bumped by the trigger); else insert.
// The full Report is stored as jsonb; metadata columns mirror it for the list view. The
// caller (saveReportAction) sanitizes the narrative HTML before this writes.
export async function saveReport(input: { id?: string; title: string; report: Report }): Promise<string> {
  const { id, title, report } = input;
  const json = JSON.stringify(report);
  if (id) {
    await exec(
      `update reports set title = $2, date_from = $3::date, date_to = $4::date,
              lenses = $5::signal_lens_t[], generated_at = $6::timestamptz, data = $7::jsonb
        where id = $1`,
      [id, title, report.range.from, report.range.to, report.lenses, report.generatedAt, json]
    );
    return id;
  }
  const row = await one<{ id: string }>(
    `insert into reports (title, date_from, date_to, lenses, generated_at, data)
       values ($1, $2::date, $3::date, $4::signal_lens_t[], $5::timestamptz, $6::jsonb)
     returning id`,
    [title, report.range.from, report.range.to, report.lenses, report.generatedAt, json]
  );
  return row!.id;
}

export async function deleteReport(id: string): Promise<void> {
  await exec(`delete from reports where id = $1`, [id]);
}

// ---- AI rate cards (cost monitoring; migration 0014) -----------------------
// Append-only pricing history: a price change is a NEW card, never an edit. One card per
// (model, effective_date) — the unique constraint rejects a duplicate effective date for a
// model (surfaced to the admin as a friendly error in addRateCardAction). Returns the new id.
export async function addRateCard(input: {
  model: string;
  effective_date: string;            // 'YYYY-MM-DD'
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  context_window: number;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into ai_rate_cards
       (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
     values ($1, $2::date, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.model,
      input.effective_date,
      input.input_per_mtok,
      input.output_per_mtok,
      input.cache_write_per_mtok,
      input.cache_read_per_mtok,
      input.context_window,
    ]
  );
  return row!.id;
}

// ---- Generated reports (the Report Portal's tear sheets, migration 0030) ----
// Insert-only like thesis reports: a re-run is a NEW row. The caller
// (saveSheetAction) re-gates the narrative against the pack at the save boundary.
// isPublished defaults to false (the human publish gate every other kind keeps);
// only the weekly research roundup cron (lib/research/roundup.ts) passes true
// (Kevin's 2026-08-30 decision to auto-publish that one kind).
export async function saveGeneratedReport(input: {
  kind: 'claim' | 'bridge' | 'lens' | 'atlas' | 'roundup';
  subject: string | null;
  title: string;
  scope_from: string | null;
  scope_to: string | null;
  pack: unknown;
  narrative: unknown;
  generated_at: string;
  isPublished?: boolean;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into generated_reports (kind, subject, title, scope_from, scope_to, pack, narrative, generated_at, is_published)
     values ($1::report_kind_t, $2, $3, $4::date, $5::date, $6::jsonb, $7::jsonb, $8::timestamptz, $9)
     returning id`,
    [
      input.kind, input.subject, input.title, input.scope_from, input.scope_to,
      JSON.stringify(input.pack), JSON.stringify(input.narrative), input.generated_at,
      input.isPublished ?? false,
    ]
  );
  return row!.id;
}

// The one mutable field: publishing is the human gate that lists a generated
// report on the public portal and opens its PDF download.
export async function setGeneratedReportPublished(id: string, on: boolean): Promise<void> {
  await exec(`update generated_reports set is_published = $2 where id = $1`, [id, on]);
}

export async function deleteGeneratedReport(id: string): Promise<void> {
  await exec(`delete from generated_reports where id = $1`, [id]);
}

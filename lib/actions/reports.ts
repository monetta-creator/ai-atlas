'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import {
  listSavedReports, getSavedReport } from '../data';
import { buildSheetPack } from '../tearsheet/retrieve';
import {
  generateSheetSections, generateSheetClose, gateSheetNarrative, type SheetSectionsOut,
} from '../tearsheet/generate';
import { buildReportData } from '../report';
import { generateLensNarrative, synthesizeReport } from '../report-generate';
import { sanitizeReportNarrative } from '../sanitize';
import { SIGNAL_LENS_SLUGS } from '../format';
import type {
  SignalLens, Report, SavedReportMeta,
  SheetPack, SheetScope, SheetNarrative,
  } from '../types';
import { UUID_RE, requireAdmin } from './shared';
import { ISO_DAY_RE } from './shared';

// ---- Report generation (Phase 2 — returns to the client; no DB write) -------
// Decomposed so each call fits the 60s cap and one failure can't kill the run: the
// client orchestrates one generateReportLensAction per active lens, then one
// synthesizeReportAction. Both re-derive their data server-side (server is the source of
// truth) and return model errors as data so the client can surface them per-lens.

export async function generateReportLensAction(
  from: string, to: string, lens: string
): Promise<
  | { ok: true; lens: SignalLens; narrative: string; callout: string }
  | { ok: false; lens: SignalLens; error: string }
> {
  await requireAdmin();
  const l = lens as SignalLens;
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  if (!(SIGNAL_LENS_SLUGS as string[]).includes(lens)) throw new Error('Invalid lens.');
  try {
    const data = await buildReportData({ from, to, lenses: [l], personal: true });
    const funnel = data.metrics.perLens[0]?.funnel;
    if (!funnel) return { ok: false, lens: l, error: 'No pipeline data for lens.' };
    const { narrative, callout } = await generateLensNarrative({
      lens: l, range: data.range, signals: data.signals, funnel, touches: data.touches,
    });
    return { ok: true, lens: l, narrative, callout };
  } catch (e) {
    return { ok: false, lens: l, error: e instanceof Error ? e.message : 'generation error' };
  }
}

export async function synthesizeReportAction(
  from: string, to: string, lenses: string[],
  lensSummaries: { lens: string; narrative: string }[]
): Promise<
  | { ok: true; macroSurvey: string; claimsRecap: string; title: string }
  | { ok: false; error: string }
> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_LENS_SLUGS);
  const ls = (Array.isArray(lenses) ? lenses : []).filter((l): l is SignalLens => valid.has(l));
  const summaries = (Array.isArray(lensSummaries) ? lensSummaries : [])
    .filter((s) => s && valid.has(s.lens) && typeof s.narrative === 'string')
    .map((s) => ({ lens: s.lens as SignalLens, narrative: s.narrative }));
  try {
    const data = await buildReportData({ from, to, lenses: ls, personal: true });
    const out = await synthesizeReport({
      range: data.range, lenses: data.lenses, signals: data.signals,
      metrics: data.metrics, touches: data.touches, lensSummaries: summaries,
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'synthesis error' };
  }
}

// Assemble the DATA half of a report for the current controls (so the client's generation
// run is self-consistent with what it generates, independent of the URL/preview scope).
export async function getReportDataAction(
  from: string, to: string, lenses: string[]
): Promise<Report> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_LENS_SLUGS);
  const ls = (Array.isArray(lenses) ? lenses : []).filter((l): l is SignalLens => valid.has(l));
  return buildReportData({ from, to, lenses: ls, personal: true });
}

// ---- Report persistence (admin; sanitizes narrative HTML at the save boundary) ----------
export async function saveReportAction(input: { id?: string; title: string; report: Report }): Promise<{ id: string }> {
  await requireAdmin();
  if (input.id && !UUID_RE.test(input.id)) throw new Error('Bad report id.');
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled report';
  const report = sanitizeReportNarrative(input.report);
  const id = await m.saveReport({ id: input.id, title, report });
  revalidatePath('/reports/period');
  revalidatePath('/reports');
  return { id };
}

export async function listSavedReportsAction(): Promise<SavedReportMeta[]> {
  await requireAdmin();
  return listSavedReports();
}

export async function getSavedReportAction(id: string): Promise<{ id: string; title: string; report: Report } | null> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  return getSavedReport(id);
}

export async function deleteReportAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.deleteReport(id);
  revalidatePath('/reports/period');
  revalidatePath('/reports');
}

// ---- The Report Portal's generated reports (tear sheets; migration 0030) ----
// Same decomposition discipline as the thesis console: pack (no AI) -> sections
// (model leg 1) -> close (model leg 2) -> save (re-gated, insert-only). Errors
// return as data so the client stepper can retry a single leg.

const SHEET_CODE_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SHEET_KINDS = ['claim', 'lens', 'atlas'] as const;

function parseSheetScope(scope: { from?: string | null; to?: string | null } | null | undefined): SheetScope {
  const from = scope?.from && ISO_DAY_RE.test(scope.from) ? scope.from : null;
  const to = scope?.to && ISO_DAY_RE.test(scope.to) ? scope.to : null;
  return { from, to };
}

export async function buildSheetPackAction(
  kind: 'claim' | 'lens' | 'atlas',
  subject: string | null,
  scope: { from?: string | null; to?: string | null } | null
): Promise<{ ok: true; pack: SheetPack } | { ok: false; error: string }> {
  await requireAdmin();
  if (!(SHEET_KINDS as readonly string[]).includes(kind)) throw new Error('Bad report kind.');
  if (kind === 'claim' && !(subject && SHEET_CODE_RE.test(subject))) throw new Error('Bad claim code.');
  if (kind === 'lens' && !(subject && (SIGNAL_LENS_SLUGS as readonly string[]).includes(subject))) {
    throw new Error('Bad lens.');
  }
  try {
    const pack = await buildSheetPack(kind, kind === 'atlas' ? null : subject, parseSheetScope(scope));
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pack build error' };
  }
}

export async function generateSheetSectionsAction(
  pack: SheetPack
): Promise<{ ok: true; sections: SheetSectionsOut } | { ok: false; error: string }> {
  await requireAdmin();
  if (!pack || !pack.kind || !pack.stats) return { ok: false, error: 'No pack. Build the evidence pack first.' };
  try {
    const sections = await generateSheetSections(pack);
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'section generation error' };
  }
}

export async function generateSheetCloseAction(
  pack: SheetPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string }
): Promise<{ ok: true; bottomLineHtml: string; title: string; dropped: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  if (!pack || !pack.kind || !pack.stats) return { ok: false, error: 'No pack. Build the evidence pack first.' };
  try {
    const out = await generateSheetClose(pack, {
      readingMd: String(sections?.readingMd ?? ''),
      connectionsMd: String(sections?.connectionsMd ?? ''),
      watchMd: String(sections?.watchMd ?? ''),
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'close generation error' };
  }
}

// Freeze a run: re-gate the narrative against the pack at the save boundary (the
// client's HTML is never trusted), insert an immutable generated_reports row.
export async function saveSheetAction(input: {
  title: string;
  pack: SheetPack;
  narrative: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null };
}): Promise<{ id: string }> {
  await requireAdmin();
  const pack = input.pack;
  if (!pack || !pack.kind || !pack.stats) throw new Error('No pack. Build the evidence pack first.');
  // 'roundup' rides here too so a re-save of an already-generated weekly roundup
  // is accepted (the console itself never offers roundup generation; see
  // lib/research/roundup.ts, which saves directly via the mutation on a cron).
  if (!['claim', 'bridge', 'lens', 'atlas', 'roundup'].includes(pack.kind)) throw new Error('Bad pack kind.');
  if ((pack.kind === 'claim' || pack.kind === 'bridge') && !(pack.subject && SHEET_CODE_RE.test(pack.subject))) {
    throw new Error('Bad pack subject.');
  }
  if (pack.kind === 'lens' && !(SIGNAL_LENS_SLUGS as readonly string[]).includes(pack.subject)) {
    throw new Error('Bad pack subject.');
  }
  if (JSON.stringify(pack).length > 2_000_000) throw new Error('Pack too large to save.');
  const scope = parseSheetScope(pack.scope);
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled report';
  const narrative: SheetNarrative = gateSheetNarrative(input.narrative, pack);
  const generated_at =
    typeof pack.generated_at === 'string' && !Number.isNaN(Date.parse(pack.generated_at))
      ? pack.generated_at
      : new Date().toISOString();
  const id = await m.saveGeneratedReport({
    kind: pack.kind,
    subject: pack.kind === 'atlas' ? null : pack.subject,
    title,
    scope_from: scope.from,
    scope_to: scope.to,
    pack,
    narrative,
    generated_at,
  });
  revalidatePath('/reports');
  return { id };
}

export async function setSheetPublishedAction(id: string, on: boolean): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.setGeneratedReportPublished(id, !!on);
  revalidatePath('/reports');
  revalidatePath(`/reports/sheet/${id}`);
}

export async function deleteSheetAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.deleteGeneratedReport(id);
  revalidatePath('/reports');
}

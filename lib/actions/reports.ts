'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import {
  listSavedReports, getSavedReport } from '../data';
import { buildReportData } from '../report';
import { generateContextNarrative, synthesizeReport } from '../report-generate';
import { sanitizeReportNarrative } from '../sanitize';
import { SIGNAL_CONTEXT_SLUGS } from '../format';
import type { SignalContext, Report, SavedReportMeta } from '../types';
import { UUID_RE, requireAdmin } from './shared';
import { ISO_DAY_RE } from './shared';

// ---- Report generation (Phase 2 — returns to the client; no DB write) -------
// Decomposed so each call stays short and one failure can't kill the run: the
// client orchestrates one generateReportContextAction per selected context, then one
// synthesizeReportAction. Both re-derive their data server-side (server is the source of
// truth) and return model errors as data so the client can surface them per-section.

export async function generateReportContextAction(
  from: string, to: string, context: string
): Promise<
  | { ok: true; context: SignalContext; narrative: string; callout: string }
  | { ok: false; context: SignalContext; error: string }
> {
  await requireAdmin();
  const c = context as SignalContext;
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  if (!(SIGNAL_CONTEXT_SLUGS as readonly string[]).includes(context)) throw new Error('Invalid context.');
  try {
    const data = await buildReportData({ from, to, contexts: [c], personal: true });
    const { narrative, callout } = await generateContextNarrative({
      context: c, range: data.range, signals: data.signals, touches: data.touches,
    });
    return { ok: true, context: c, narrative, callout };
  } catch (e) {
    return { ok: false, context: c, error: e instanceof Error ? e.message : 'generation error' };
  }
}

export async function synthesizeReportAction(
  from: string, to: string, contexts: string[],
  contextSummaries: { context: string; narrative: string }[]
): Promise<
  | { ok: true; macroSurvey: string; claimsRecap: string; title: string }
  | { ok: false; error: string }
> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_CONTEXT_SLUGS);
  const cs = (Array.isArray(contexts) ? contexts : []).filter((c): c is SignalContext => valid.has(c));
  const summaries = (Array.isArray(contextSummaries) ? contextSummaries : [])
    .filter((s) => s && valid.has(s.context) && typeof s.narrative === 'string')
    .map((s) => ({ context: s.context as SignalContext, narrative: s.narrative }));
  try {
    const data = await buildReportData({ from, to, contexts: cs, personal: true });
    const out = await synthesizeReport({
      range: data.range, contexts: data.contexts, signals: data.signals,
      touches: data.touches, contextSummaries: summaries,
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'synthesis error' };
  }
}

// Assemble the DATA half of a report for the current controls (so the client's generation
// run is self-consistent with what it generates, independent of the URL/preview scope).
export async function getReportDataAction(
  from: string, to: string, contexts: string[]
): Promise<Report> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_CONTEXT_SLUGS);
  const cs = (Array.isArray(contexts) ? contexts : []).filter((c): c is SignalContext => valid.has(c));
  return buildReportData({ from, to, contexts: cs, personal: true });
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

'use server';

import { revalidatePath } from 'next/cache';
import { checkKeyBudget, checkPortalBudget } from '../portal/budget';
import type { PortalIdentity } from '../portal/identity';
import { requireAdmin, requirePortal, portalKeyMetadata, UUID_RE } from './shared';
import { getGeneratedReport } from '../data';
import { saveGeneratedReport, setGeneratedReportPublished } from '../mutations';
import {
  TOOLING_REPORT_KINDS, buildToolingPack, generateToolingSections, generateToolingClose, gateToolingNarrative,
} from '../tooling/reports';
import type {
  ToolingReportKind, ToolingLandscapeParams, ToolingBriefParams, ToolingEntrantsParams, ToolingFeaturesParams,
  ToolingSectionsOut,
} from '../tooling/reports';
import type { ToolingPack, ToolingViewer, SheetNarrative } from '../types';

// The AI Tooling Monitor's report console actions (Work Package 4b): the
// same pack -> sections -> close -> save decomposition SheetConsole uses
// (buildSheetPackAction et al.), ported for the four tooling report kinds.
// A portal keyholder may generate AND save a report (not just an admin);
// only an admin may publish one. A non-admin keyholder's two model legs are
// metered against the shared portal daily budget and logged under the
// 'portal_tooling' feature slug (checkPortalBudget sums that slug); an
// admin's legs log under lib/tooling/reports.ts's own defaults
// ('tooling_report_sections' / 'tooling_report_close'). Errors from a model
// or a pack build return as data (the client stepper needs the message to
// retry a single leg); a bad id or a non-tooling kind on publish throws
// (the house convention for a plain guarded write).

function isValidToolingPack(pack: unknown): pack is ToolingPack {
  return (
    !!pack && typeof pack === 'object' &&
    (TOOLING_REPORT_KINDS as readonly string[]).includes((pack as { kind?: string }).kind ?? '') &&
    !!(pack as { stats?: unknown }).stats
  );
}

function budgetMessage(budget: { spentUsd: number; capUsd: number }): string {
  return `The team's daily research budget is spent for today ($${budget.spentUsd.toFixed(2)} of ` +
    `$${budget.capUsd.toFixed(2)}). Try again tomorrow, or ask the Atlas owner to raise PORTAL_DAILY_BUDGET_USD.`;
}

// A non-admin keyholder's model leg passes the portal-wide budget and, for a
// per-person key, that key's own daily cap. Returns the error message or null.
async function portalBudgetError(viewer: PortalIdentity): Promise<string | null> {
  if (viewer.tier === 'admin') return null;
  const budget = await checkPortalBudget();
  if (!budget.ok) return budgetMessage(budget);
  if (viewer.tier === 'key' && viewer.keyId) {
    const own = await checkKeyBudget(viewer.keyId);
    if (!own.ok) return 'Your access key has reached its daily budget. It resets at midnight UTC.';
  }
  return null;
}

// The keyholder's cost-log options: feature 'portal_tooling' so the portal
// budget counts the leg, metadata.portal_key_id so the per-key sum does.
function portalLegOpts(viewer: PortalIdentity): { feature: string; metadata?: Record<string, unknown> } | undefined {
  if (viewer.tier === 'admin') return undefined;
  return { feature: 'portal_tooling', metadata: portalKeyMetadata(viewer) };
}

export async function buildToolingPackAction(
  kind: string,
  params: Record<string, unknown>
): Promise<{ ok: true; pack: ToolingPack } | { ok: false; error: string }> {
  const identity = await requirePortal();
  if (!(TOOLING_REPORT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'Bad report kind.' };
  }
  const admin = identity.tier === 'admin';
  const viewer: ToolingViewer = { admin, portal: true };
  const k = kind as ToolingReportKind;
  try {
    let pack: ToolingPack;
    if (k === 'tooling_landscape') {
      pack = await buildToolingPack(k, (params ?? {}) as unknown as ToolingLandscapeParams, viewer);
    } else if (k === 'tooling_brief') {
      pack = await buildToolingPack(k, (params ?? {}) as unknown as ToolingBriefParams, viewer);
    } else if (k === 'tooling_entrants') {
      pack = await buildToolingPack(k, (params ?? {}) as unknown as ToolingEntrantsParams, viewer);
    } else {
      pack = await buildToolingPack(k, (params ?? {}) as unknown as ToolingFeaturesParams, viewer);
    }
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pack build error' };
  }
}

export async function generateToolingSectionsAction(
  pack: ToolingPack,
  steering: string | null
): Promise<{ ok: true; sections: ToolingSectionsOut } | { ok: false; error: string }> {
  const viewer = await requirePortal();
  if (!isValidToolingPack(pack)) return { ok: false, error: 'No pack. Build the report pack first.' };
  const budgetError = await portalBudgetError(viewer);
  if (budgetError) return { ok: false, error: budgetError };
  const steer = String(steering ?? '').trim().slice(0, 1500) || null;
  try {
    const sections = await generateToolingSections(pack, steer, portalLegOpts(viewer));
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'section generation error' };
  }
}

export async function generateToolingCloseAction(
  pack: ToolingPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string }
): Promise<{ ok: true; bottomLineHtml: string; title: string; dropped: string[] } | { ok: false; error: string }> {
  const viewer = await requirePortal();
  if (!isValidToolingPack(pack)) return { ok: false, error: 'No pack. Build the report pack first.' };
  const budgetError = await portalBudgetError(viewer);
  if (budgetError) return { ok: false, error: budgetError };
  try {
    const out = await generateToolingClose(
      pack,
      {
        readingMd: String(sections?.readingMd ?? ''),
        connectionsMd: String(sections?.connectionsMd ?? ''),
        watchMd: String(sections?.watchMd ?? ''),
      },
      portalLegOpts(viewer)
    );
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'close generation error' };
  }
}

// Freeze a run: re-gate the narrative against the pack at the save boundary
// (the client's HTML is never trusted), insert an immutable generated_reports
// row as a draft. subject mirrors SheetRow.tsx's read of it: the category
// NAME for landscape/features, the capability text for the brief, the
// literal 'week' for entrants (its own subjectLabel is derived from
// scope_to instead). Only entrants carries a scope window.
export async function saveToolingReportAction(input: {
  title: string;
  pack: ToolingPack;
  narrative: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null };
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePortal();
  const pack = input.pack;
  if (!isValidToolingPack(pack)) return { ok: false, error: 'No pack. Build the report pack first.' };
  if (JSON.stringify(pack).length > 2_000_000) return { ok: false, error: 'Pack too large to save.' };
  try {
    const narrative: SheetNarrative = gateToolingNarrative(input.narrative, pack);
    const title = (input.title || '').trim().slice(0, 200) || 'Untitled report';
    const subject =
      pack.kind === 'tooling_landscape' ? pack.category_name :
      pack.kind === 'tooling_features' ? pack.category_name :
      pack.kind === 'tooling_brief' ? pack.capability :
      'week';
    const scope_from = pack.kind === 'tooling_entrants' ? pack.from : null;
    const scope_to = pack.kind === 'tooling_entrants' ? pack.to : null;
    const generated_at =
      typeof pack.builtAt === 'string' && !Number.isNaN(Date.parse(pack.builtAt))
        ? pack.builtAt
        : new Date().toISOString();
    const id = await saveGeneratedReport({
      kind: pack.kind,
      subject,
      title,
      scope_from,
      scope_to,
      pack,
      narrative,
      generated_at,
      isPublished: false,
    });
    revalidatePath('/reports');
    revalidatePath('/tooling/reports');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'save error' };
  }
}

// Admin-only, and scoped to the four tooling kinds (a defensive belt beside
// setSheetPublishedAction's kind-agnostic write, since this console never
// hands the client a non-tooling report id): publishing a brief makes its
// narrative, including whatever it inferred from the internal context, public.
export async function setToolingReportPublishedAction(id: string, on: boolean): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  const saved = await getGeneratedReport(id);
  if (!saved) throw new Error('Report not found.');
  if (!String(saved.kind).startsWith('tooling_')) throw new Error('Not a tooling report.');
  await setGeneratedReportPublished(id, Boolean(on));
  revalidatePath('/reports');
  revalidatePath('/tooling/reports');
  revalidatePath(`/reports/sheet/${id}`);
}

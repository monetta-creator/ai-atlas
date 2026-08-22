'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, isPreview } from '../auth';
import * as m from '../mutations';
import {
  getSource, getTargets, getSignalsPage, getCandidate, getCandidateBySourceId, getSignalIdBySource,
} from '../data';
import { SIGNAL_LENS_SLUGS } from '../format';
import { triageChunk } from '../pipeline/triage';
import { domainOf } from '../text';
import type {
  Direction, Significance, SignalLens, TriageStatus,
  SignalsFeedFilters, SignalsPageResult, } from '../types';
import { DIRECTIONS, UUID_RE, requireAdmin, safePath, str } from './shared';
import { parseStringArray } from './shared';

// ===== Signal Board =========================================================

const SIGNIFICANCES: Significance[] = ['high', 'medium', 'low'];

// Per-touch {direction, reason} keyed by code, as posted by SignalForm.
function parseTouchDetails(raw: string): Record<string, { direction?: string; reason?: string }> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// Read + validate the shared signal fields from a create/edit form. claim_touches is
// validated against the live claim/bridge code list so junk never persists.
async function readSignalFields(formData: FormData) {
  const title = str(formData, 'title');
  if (!title) throw new Error('A signal needs a title.');

  const significance = str(formData, 'significance');
  if (!(SIGNIFICANCES as string[]).includes(significance)) throw new Error('Invalid significance.');

  const lenses = parseStringArray(str(formData, 'lenses'))
    .filter((l): l is SignalLens => (SIGNAL_LENS_SLUGS as string[]).includes(l));

  const { claims, bridges } = await getTargets();
  const validCodes = new Set([...claims, ...bridges].map((t) => t.code));
  const claim_touches = Array.from(
    new Set(parseStringArray(str(formData, 'claim_touches')).filter((c) => validCodes.has(c)))
  );

  // Per-touch direction + reason — one entry per validated touch (default neutral so
  // every touch materializes with an honest direction). Direction is allow-listed.
  const rawDetails = parseTouchDetails(str(formData, 'touch_details'));
  const touch_details: Record<string, { direction: Direction; reason: string }> = {};
  for (const code of claim_touches) {
    const d = rawDetails[code];
    const direction = d && DIRECTIONS.includes(d.direction as Direction) ? (d.direction as Direction) : 'neutral';
    touch_details[code] = { direction, reason: d?.reason ? String(d.reason).slice(0, 2000) : '' };
  }

  const sourceIdRaw = str(formData, 'source_id');
  if (sourceIdRaw && !UUID_RE.test(sourceIdRaw)) throw new Error('Bad source id.');

  return {
    title,
    summary: str(formData, 'summary') || null,
    significance: significance as Significance,
    lenses,
    claim_touches,
    touch_details,
    source_id: sourceIdRaw || null,
    published_at: str(formData, 'published_at') || null,
  };
}

export async function createSignalAction(formData: FormData) {
  await requireAdmin();
  const fields = await readSignalFields(formData);
  const publish = str(formData, 'intent') === 'publish';
  const id = await m.createSignal({ ...fields, is_published: publish });
  revalidatePath('/', 'layout');
  redirect(`/signals/${id}`);
}

export async function updateSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  const fields = await readSignalFields(formData);
  await m.updateSignal(id, fields);
  revalidatePath('/', 'layout');
  redirect(`/signals/${id}`);
}

// Publish / unpublish toggle — visibility only (editorial date is left alone).
// Text retention happens at INTAKE time now (the candidate/source carries its
// text before it can be analyzed), so there is no fetch here; the coverage stat
// on /pipeline remains the audit surface for any legacy gaps.
export async function publishSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  const publishing = str(formData, 'publish') === '1';
  await m.setSignalPublished(id, publishing);
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

// Archive / unarchive a draft (set it aside out of the active queue, or restore it).
export async function archiveSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  await m.setSignalArchived(id, true);
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

export async function unarchiveSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  await m.setSignalArchived(id, false);
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

export async function deleteSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  await m.deleteSignal(id);
  revalidatePath('/', 'layout');
  redirect('/signals');
}

// Turn a manual source into a signal through the SAME steps as discovery: seed it as a
// (pre-approved-able) candidate, run FULL triage, and hand the client a triage verdict. The
// client then calls analyzeCandidateAction (and overrideAndApproveAction first if triage
// rejected it). Idempotent on repeat clicks. Split so no single call runs both LLM legs
// (triage + analysis) back-to-back — each stays under the 60s cap.
export async function prepareSignalFromSourceAction(sourceId: string): Promise<{
  status: 'exists' | 'ready';
  signalId?: string;
  candidateId?: string;
  runId?: string;
  triage_status?: TriageStatus;
  reason?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(sourceId)) throw new Error('Bad source id.');

  // Already a signal from this source? Send the admin straight there (handles the double-click).
  const existingSignal = await getSignalIdBySource(sourceId);
  if (existingSignal) return { status: 'exists', signalId: existingSignal };

  const data = await getSource(sourceId);
  if (!data) throw new Error('Source not found.');
  const src = data.source;
  const text = (src.raw_text || '').trim();
  if (!text) throw new Error('This source has no text to analyze. Add the source text first.');

  // Resume an in-flight candidate from a prior attempt rather than creating a second run.
  let candidate = await getCandidateBySourceId(sourceId);
  let runId: string;
  if (candidate && !candidate.signal_id) {
    runId = candidate.run_id;
  } else {
    runId = await m.createRun('source');
    const candidateId = await m.createSourceCandidate({
      runId,
      sourceId,
      url: src.url || `urn:source:${sourceId}`, // candidate.url is NOT NULL; raw_content set => no fetch
      headline: src.title,
      source_domain: domainOf(src.url || '') || src.outlet || null,
      lens: 'market', // seed only — analyzeCandidate uses the model's lenses; this is the fallback
      published_date: src.published_at ? new Date(src.published_at).toISOString().slice(0, 10) : null,
      raw_content: text,
    });
    candidate = await getCandidate(candidateId);
  }

  await triageChunk(runId); // no-op for an already-decided (resumed) candidate
  candidate = await getCandidate(candidate!.id);
  if (!candidate) throw new Error('Candidate not found after triage.');
  await m.recomputeRunCounts(runId);
  revalidatePath('/pipeline');

  return {
    status: 'ready',
    candidateId: candidate.id,
    runId,
    triage_status: candidate.triage_status,
    reason: candidate.triage_reason ?? undefined,
  };
}

// Override a triage rejection/duplicate and approve ("Create anyway"). Typed-arg sibling of
// the form-driven overrideTriageAction, for the manual Turn-into-signal client flow.
export async function overrideAndApproveAction(candidateId: string, runId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(candidateId) || !UUID_RE.test(runId)) throw new Error('Bad id.');
  await m.setTriage(candidateId, 'approved', 'admin override');
  await m.recomputeRunCounts(runId);
  revalidatePath('/pipeline');
}

// Paginated/filterable/searchable feed read for the Signal Board (admin board + guest feed).
// This is a PUBLIC read action (guests use the feed too) but it is the draft-visibility
// BOUNDARY: it recomputes `personal` server-side and forces guests to published-only, never
// trusting a client-supplied status. Every filter is validated/allow-listed; pageSize fixed.
export async function getSignalsFeedAction(filters: SignalsFeedFilters): Promise<SignalsPageResult> {
  const personal = (await isAdmin()) && !(await isPreview());
  const f = filters ?? {};
  const status =
    personal && (f.status === 'published' || f.status === 'unpublished' || f.status === 'archived')
      ? f.status : undefined;
  const lenses = Array.isArray(f.lenses)
    ? f.lenses.filter((l): l is SignalLens => (SIGNAL_LENS_SLUGS as string[]).includes(l as string))
    : undefined;
  const significance = Array.isArray(f.significance)
    ? f.significance.filter((s): s is Significance => (SIGNIFICANCES as string[]).includes(s as string))
    : undefined;
  const search = (typeof f.search === 'string' ? f.search : '').slice(0, 120).trim() || undefined;
  const page = Number.isInteger(f.page) && (f.page as number) > 0 ? Math.min(f.page as number, 100_000) : 1;
  return getSignalsPage({ admin: personal, status, lenses, significance, search, page });
}

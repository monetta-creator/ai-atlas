'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import {
  getApprovedCandidates, getCandidateArchive, getDedupeScan,
  countPendingCandidates,
  } from '../data';
import { SIGNAL_CONTEXT_SLUGS } from '../format';
import { triageChunk } from '../pipeline/triage';
import { analyzeCandidate } from '../pipeline/analysis';
import { dedupeAllDrafts } from '../pipeline/dedupe';
import type {
  Significance, SignalContext, TriageStatus,
  CandidateArchiveFilters, CandidateArchiveResult,
  DedupeRecommendation,
  } from '../types';
import { UUID_RE, requireAdmin, str } from './shared';

// ===== Intake pipeline ======================================================
// All steps are admin-gated, typed-arg actions that return data to the client
// orchestrator (no redirect). Each is short by design — one chunk / one candidate —
// which keeps every call cheap to retry and every run resumable. Candidates enter
// through manual/document intake (prepareSignalFromSourceAction) with their text
// retained at intake time; there is no web-discovery leg.

// One bounded triage chunk per call (the client loops until remaining === 0), so each call
// stays short regardless of candidate volume. Returns the approved ids the analysis
// step consumes once the queue is drained.
export async function triageChunkAction(runId: string): Promise<{
  processed: number; approved: number; rejected: number; duplicate: number;
  remaining: number; approvedIds?: string[];
}> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  const r = await triageChunk(runId);
  revalidatePath('/pipeline');
  if (r.remaining === 0) {
    const approved = await getApprovedCandidates(runId);
    return { ...r, approvedIds: approved.filter((c) => !c.signal_id).map((c) => c.id) };
  }
  return r;
}

export async function analyzeCandidateAction(candidateId: string): Promise<{
  ok: boolean; skipped?: boolean; error?: string; status?: number; terminal?: boolean;
  signalId?: string;
  title?: string; significance?: Significance; reliability?: number; touches?: number;
}> {
  await requireAdmin();
  if (!UUID_RE.test(candidateId)) throw new Error('Bad candidate id.');
  // Catch + RETURN the failure as data (don't let it throw): Next redacts THROWN
  // server-action errors in prod ("An error occurred in the Server Components render…"),
  // so a thrown analyze error reaches the orchestrator as an opaque string. Returning the
  // real message (and HTTP status, e.g. 403 paywall / 429 rate-limit) lets the orchestrator
  // back off appropriately and flag with a useful reason. A null result is the idempotent
  // no-op (already drafted / claimed by a peer).
  try {
    const res = await analyzeCandidate(candidateId);
    if (!res) return { ok: true, skipped: true };
    return {
      ok: true,
      signalId: res.signalId,
      title: res.analysis.title,
      significance: res.analysis.significance,
      reliability: res.analysis.proposed_reliability,
      touches: res.analysis.touches.length,
    };
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    const msg = e instanceof Error ? e.message : 'analysis error';
    // Terminal = retrying cannot succeed: missing retained text, or a model 4xx that
    // isn't a rate limit (e.g. 400 request-too-large).
    const terminal =
      /no retained text/.test(msg) || status === 400 || status === 413;
    // Record the failed attempt so the dashboard's analysis-health view is real. A later
    // successful retry overwrites this with 'drafted'; a final give-up sets 'discarded'.
    // Never let the status write mask the real error the orchestrator needs to back off on.
    await m.setAnalysisStatus(candidateId, 'error', msg.slice(0, 500)).catch(() => {});
    return { ok: false, error: msg, status, terminal };
  }
}

// After the orchestrator exhausts retries on a candidate, terminalize it so it stops
// re-queuing: mark it 'rejected' with an 'unanalyzable:' reason (surfaced in the candidate
// list for manual handling). NOT a fabricated draft — the source text was never usable.
export async function markCandidateUnanalyzableAction(
  runId: string, candidateId: string, reason: string
): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId) || !UUID_RE.test(candidateId)) throw new Error('Bad id.');
  const note = `unanalyzable: ${String(reason ?? '').slice(0, 280)}`;
  // Keep the existing triage flip (it's what stops the orchestrator re-queuing the
  // candidate) AND record the terminal analysis outcome so analysis-health is accurate.
  await m.setTriage(candidateId, 'rejected', note);
  await m.setAnalysisStatus(candidateId, 'discarded', note);
  await m.recomputeRunCounts(runId);
  revalidatePath('/pipeline');
}

// The analysis queue: approved candidates that still have no draft. Lets the orchestrator
// check for leftovers (only completing the run when none remain) and resume later.
export async function pendingAnalysisIdsAction(runId: string): Promise<string[]> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  const approved = await getApprovedCandidates(runId);
  return approved.filter((c) => !c.signal_id).map((c) => c.id);
}

// Home-dashboard candidate archive (section 3). A PUBLIC read action — the archive is
// visible to guests and returns only pipeline metadata (no personal-layer fields), so it
// is intentionally NOT admin-gated. Every filter is validated/allow-listed here; the
// data layer parameterizes the rest. pageSize is fixed server-side.
export async function getCandidateArchiveAction(
  filters: CandidateArchiveFilters
): Promise<CandidateArchiveResult> {
  const f = filters ?? {};
  const context = (SIGNAL_CONTEXT_SLUGS as readonly string[]).includes(f.context as string)
    ? (f.context as SignalContext) : undefined;
  const TRIAGE: TriageStatus[] = ['pending', 'approved', 'rejected', 'duplicate'];
  const triage_status = (TRIAGE as string[]).includes(f.triage_status as string)
    ? (f.triage_status as TriageStatus) : undefined;
  const dateField = f.dateField === 'published_date' ? 'published_date' : 'retrieved_at';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const from = f.from && DATE_RE.test(f.from) ? f.from : undefined;
  const to = f.to && DATE_RE.test(f.to) ? f.to : undefined;
  const search = (typeof f.search === 'string' ? f.search : '').slice(0, 120).trim() || undefined;
  const page = Number.isInteger(f.page) && (f.page as number) > 0 ? Math.min(f.page as number, 100_000) : 1;
  return getCandidateArchive({ context, triage_status, dateField, from, to, search, page, pageSize: 25 });
}

export async function completePipelineRunAction(runId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  // A run cannot complete while candidates are still un-triaged — that's how runs ended up
  // "completed" with a pile of orphaned 'pending'. Triage them, or archive the stragglers
  // (archived candidates don't count here). This is the hard invariant; the console pre-checks
  // it too (pendingTriageCountAction) so the normal flow never trips this throw.
  const pending = await countPendingCandidates(runId);
  if (pending > 0) {
    throw new Error(`Cannot complete: ${pending} candidate${pending === 1 ? '' : 's'} still pending triage. Triage or archive them first.`);
  }
  await m.updateRun(runId, { step: 'complete', status: 'completed' });
  await m.recomputeRunCounts(runId);
  revalidatePath('/pipeline');
}

// Lightweight pre-check the console uses before attempting to complete a run, so it can leave
// the run resumable (and guide the admin) instead of tripping completePipelineRunAction's throw.
export async function pendingTriageCountAction(runId: string): Promise<number> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  return countPendingCandidates(runId);
}

export async function failPipelineRunAction(runId: string, message: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  await m.updateRun(runId, { status: 'failed', error: String(message ?? '').slice(0, 500) });
  revalidatePath('/pipeline');
}

// Admin override of a triage decision before analysis (form-driven; revalidates the page).
const TRIAGE_OVERRIDE: TriageStatus[] = ['approved', 'rejected'];
export async function overrideTriageAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'candidate_id');
  if (!UUID_RE.test(id)) throw new Error('Bad candidate id.');
  const status = str(formData, 'status');
  if (!(TRIAGE_OVERRIDE as string[]).includes(status)) throw new Error('Invalid status.');
  await m.setTriage(id, status as TriageStatus, 'admin override');
  // keep the owning run's tallies honest
  const runId = str(formData, 'run_id');
  if (UUID_RE.test(runId)) await m.recomputeRunCounts(runId);
  revalidatePath('/pipeline');
}

// Archive / unarchive a candidate (migration 0013): set it aside out of the active review
// queue + the funnel's live buckets, or restore it. `archived` = '1' archives, '0' restores.
// Doesn't touch triage_status or run tallies (archived stays part of "discovered"); revalidate
// the layout so both /pipeline and the home funnel reflect it.
export async function setCandidateArchivedAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'candidate_id');
  if (!UUID_RE.test(id)) throw new Error('Bad candidate id.');
  await m.setCandidateArchived(id, str(formData, 'archived') === '1');
  revalidatePath('/', 'layout');
}

// ===== Draft-queue dedupe (manual, admin-triggered) =========================
// The admin clicks "Scan for duplicates" on the Draft queue; this scans ALL unpublished
// drafts for same-story duplicates and returns the grouped recommendation. Recommend-only —
// the admin then merges or discards (below). It NEVER runs automatically.
export async function dedupeDraftsAction(): Promise<DedupeRecommendation> {
  await requireAdmin();
  const rec = await dedupeAllDrafts();
  await m.saveDedupeScan(rec);   // persist so the review survives a refresh
  return rec;
}

// Dismiss one group from the persisted scan ("not duplicates") so it stays gone after a refresh.
export async function dismissDedupeGroupAction(canonicalSignalId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(canonicalSignalId)) throw new Error('Bad id.');
  const rec = await getDedupeScan();
  if (!rec) return;
  const groups = rec.groups.filter((g) => g.canonical.signal_id !== canonicalSignalId);
  await m.saveDedupeScan(groups.length ? { ...rec, groups } : null);
  revalidatePath('/signals/drafts');
}

// Clear the whole persisted scan.
export async function clearDedupeScanAction(): Promise<void> {
  await requireAdmin();
  await m.saveDedupeScan(null);
  revalidatePath('/signals/drafts');
}

// Merge duplicate drafts into the canonical (union touches/lenses, widen significance, append
// the discarded sources' URLs to the canonical summary), then delete the duplicates. The
// mutation returns the affected runs so their candidate tallies can be refreshed.
export async function mergeDraftSignalsAction(canonicalId: string, duplicateIds: string[]): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(canonicalId)) throw new Error('Bad id.');
  const dupes = (Array.isArray(duplicateIds) ? duplicateIds : []).filter((id) => UUID_RE.test(id));
  if (!dupes.length) throw new Error('No duplicates to merge.');
  const runIds = await m.mergeDraftSignals(canonicalId, dupes);
  for (const rid of runIds) await m.recomputeRunCounts(rid);
  revalidatePath('/signals/drafts');
  revalidatePath('/pipeline');
  revalidatePath('/', 'layout');
}

// Discard a single unpublished draft from the dedupe review.
export async function discardDraftSignalAction(signalId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(signalId)) throw new Error('Bad id.');
  const runIds = await m.discardDraftSignal(signalId);
  for (const rid of runIds) await m.recomputeRunCounts(rid);
  revalidatePath('/signals/drafts');
  revalidatePath('/pipeline');
  revalidatePath('/', 'layout');
}

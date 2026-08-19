'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import {
  getLastCompletedRunAt, getApprovedCandidates, getCandidateArchive, getDedupeScan,
  countPendingCandidates,
  getCandidate, isFetchHostileDomain } from '../data';
import { SIGNAL_LENS_SLUGS } from '../format';
import { discoverBatch, discoverBreakingSweep, discoveryPlan, type DiscoveryBatchRef } from '../pipeline/discovery';
import { runCoverageCheck } from '../pipeline/coverage';
import { triageChunk } from '../pipeline/triage';
import { analyzeCandidate } from '../pipeline/analysis';
import { domainOf, fetchCandidateText, FetchFailure } from '../pipeline/web';
import { dedupeAllDrafts } from '../pipeline/dedupe';
import type {
  Significance, SignalLens, RunCadence, TriageStatus,
  CandidateArchiveFilters, CandidateArchiveResult,
  DedupeRecommendation, RunCoverage,
  } from '../types';
import { UUID_RE, requireAdmin, str } from './shared';

// ===== Discovery pipeline ===================================================
// All steps are admin-gated, typed-arg actions that return data to the client
// orchestrator (no redirect). Each is short by design — one batch / one candidate —
// to stay under the Hobby 60s cap; the client drives the loop and polls progress.

// Start a run: create the row, compute the lookback window, and hand the client the
// ordered batch plan to execute.
export async function startPipelineRunAction(
  cadence: string, lookbackDays: number
): Promise<{ runId: string; plan: DiscoveryBatchRef[]; sinceISO: string }> {
  await requireAdmin();
  if (cadence !== 'daily' && cadence !== 'weekly') throw new Error('Invalid cadence.');
  const lookback = lookbackDays === 1 ? 1 : 7;
  const windowStart = Date.now() - lookback * 86_400_000;
  const last = await getLastCompletedRunAt();
  const lastMs = last ? new Date(last).getTime() : 0;
  // "last N days, or since the last run, whichever is shorter" -> the more recent start
  const sinceISO = new Date(Math.max(windowStart, lastMs)).toISOString().slice(0, 10);
  const runId = await m.createRun(cadence as RunCadence);
  return { runId, plan: discoveryPlan(cadence as RunCadence), sinceISO };
}

export async function discoverBatchAction(
  runId: string, lens: string, batchIndex: number, sinceISO: string
): Promise<{ inserted: number }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  if (!(SIGNAL_LENS_SLUGS as string[]).includes(lens)) throw new Error('Invalid lens.');
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 50) throw new Error('Bad batch index.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceISO)) throw new Error('Bad since date.');
  const inserted = await discoverBatch(runId, lens as SignalLens, batchIndex, sinceISO);
  return { inserted };
}

// The breaking-events sweep: one extra lens-agnostic discovery unit per run (quality-outlet
// allowlist, significance-first — see lib/pipeline/discovery.ts). Idempotent like
// discoverBatch, so the client retries it the same way.
export async function discoverBreakingSweepAction(
  runId: string, sinceISO: string
): Promise<{ inserted: number }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceISO)) throw new Error('Bad since date.');
  const inserted = await discoverBreakingSweep(runId, sinceISO);
  return { inserted };
}

// The post-run coverage check (advisory): re-derives the window's most significant AI
// developments with independent phrasing and marks each covered/missed against the run's
// candidates + existing signals. Persists onto the run row; result also returns to the
// console for the live log.
export async function coverageCheckAction(runId: string): Promise<RunCoverage> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  const coverage = await runCoverageCheck(runId);
  revalidatePath('/pipeline');
  return coverage;
}

// One bounded triage chunk per call (the client loops until remaining === 0), so each call
// fits the 60s cap regardless of candidate volume. Returns the approved ids the analysis
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

// Stage 1 of analysis: fetch + cache the candidate's readable text in its OWN invocation,
// so the whole 60s budget is available for slow hosts / PDF extraction / fallbacks and the
// model leg (stage 2) never pays for the fetch. Failures come back as data; `terminal`
// tells the orchestrator a retry cannot succeed (403, bad URL, unparseable document) so it
// flags immediately instead of burning attempts on a deterministic outcome.
export async function hydrateCandidateAction(candidateId: string): Promise<{
  ok: boolean; skipped?: boolean; error?: string; terminal?: boolean; via?: 'direct' | 'jina';
}> {
  await requireAdmin();
  if (!UUID_RE.test(candidateId)) throw new Error('Bad candidate id.');
  try {
    const cand = await getCandidate(candidateId);
    if (!cand) return { ok: false, error: 'candidate not found', terminal: true };
    if (cand.signal_id || cand.raw_content) return { ok: true, skipped: true };
    // Learned routing: a domain whose history says direct fetches are doomed (reader-only
    // successes, terminal access walls) goes straight to the reader.
    const domain = (cand.source_domain || domainOf(cand.url)).toLowerCase().replace(/^www\./, '');
    const preferJina = domain ? await isFetchHostileDomain(domain).catch(() => false) : false;
    const { text, via } = await fetchCandidateText(cand.url, { preferJina });
    await m.setCandidateRawContent(candidateId, text, via);
    return { ok: true, via };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch error';
    const terminal = e instanceof FetchFailure ? e.terminal : false;
    // Record the failed attempt (analysis-health view); a later success overwrites it.
    await m.setAnalysisStatus(candidateId, 'error', msg.slice(0, 500)).catch(() => {});
    return { ok: false, error: msg, terminal };
  }
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
      touches: res.analysis.claim_touches.length,
    };
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    const msg = e instanceof Error ? e.message : 'analysis error';
    // Terminal = retrying cannot succeed: a classified fetch failure from the backstop
    // path, or a model 4xx that isn't a rate limit (e.g. 400 request-too-large).
    const terminal =
      e instanceof FetchFailure ? e.terminal : status === 400 || status === 413;
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
  const lens = (SIGNAL_LENS_SLUGS as string[]).includes(f.lens as string)
    ? (f.lens as SignalLens) : undefined;
  const TRIAGE: TriageStatus[] = ['pending', 'approved', 'rejected', 'duplicate'];
  const triage_status = (TRIAGE as string[]).includes(f.triage_status as string)
    ? (f.triage_status as TriageStatus) : undefined;
  const dateField = f.dateField === 'published_date' ? 'published_date' : 'retrieved_at';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const from = f.from && DATE_RE.test(f.from) ? f.from : undefined;
  const to = f.to && DATE_RE.test(f.to) ? f.to : undefined;
  const search = (typeof f.search === 'string' ? f.search : '').slice(0, 120).trim() || undefined;
  const page = Number.isInteger(f.page) && (f.page as number) > 0 ? Math.min(f.page as number, 100_000) : 1;
  return getCandidateArchive({ lens, triage_status, dateField, from, to, search, page, pageSize: 25 });
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

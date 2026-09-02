'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import {
  getSource, getCandidate, getCandidateBySourceId, getSignal, getLastResearchRunAt, countPendingPapers, getPaper, getThreadBySlug, getThreadScan, getResearchRun } from '../data';
import { triageChunk } from '../pipeline/triage';
import { domainOf, FetchFailure } from '../pipeline/web';
import { pullPage } from '../research/pull';
import { triagePapersChunk } from '../research/triage';
import { parseArxivRef, fetchArxivByIds } from '../research/arxiv';
import { hydratePaper, analyzePaper, promotableText } from '../research/analysis';
import { recommendQueueChunk } from '../research/queue-agent';
import { updateThreadSynthesis } from '../research/synthesis';
import { diagnoseThreadGaps } from '../research/thread-scan';
import { refreshCitations } from '../research/citations';
import { getOrCreateTodayResearchRun, claimResearchRun, advanceResearchRun } from '../research/engine';
import { isScanEnrichModel } from '../scan/models';
import type {
  TriageStatus,
  PaperReviewStatus, ThreadRelation, ThreadStatus, ResearchThreadScan, ResearchProgress,
  } from '../types';
import { UUID_RE, parsePrior, requireAdmin, str } from './shared';

// ===== Research section (docs/research-section.md) ==========================
// Manual, console-driven runs over the arXiv intake — the same shape as the
// discovery pipeline: typed-arg admin actions, one short checkpointed unit per
// call, the client loops. Cost at rest is zero (no cron anywhere).

// Start a research run: prune expired rejects (opportunistic, no cron), compute the
// window (the ADMIN-CHOSEN lookback, default 7 days, hard-capped at 14 — volume
// control is the admin's, a lesson from the 3,000-paper first run), narrowed to the
// last completed run's pull with 1 day of idempotent overlap. Create the run row.
export async function startResearchRunAction(lookbackDays = 7): Promise<{ runId: string; sinceISO: string }> {
  await requireAdmin();
  const lookback = Number.isInteger(lookbackDays) ? Math.min(Math.max(lookbackDays, 1), 14) : 7;
  await m.pruneRejectedPapers().catch(() => {});
  const windowStart = Date.now() - lookback * 86_400_000;
  const last = await getLastResearchRunAt();
  const lastMs = last ? new Date(last).getTime() - 86_400_000 : 0;
  // "last N days, or since the last run, whichever is shorter" -> the more recent start
  const sinceISO = new Date(Math.max(windowStart, lastMs)).toISOString().slice(0, 10);
  const runId = await m.createResearchRun(sinceISO);
  return { runId, sinceISO };
}

// One arXiv page per invocation (politeness + the 60s cap). No AI cost.
export async function pullArxivPageAction(
  runId: string, start: number, sinceISO: string
): Promise<{ scanned: number; inserted: number; done: boolean; nextStart: number }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  if (!Number.isInteger(start) || start < 0 || start > 30_000) throw new Error('Bad start offset.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceISO)) throw new Error('Bad since date.');
  return pullPage(runId, start, sinceISO);
}

// One bounded triage chunk per call; the client loops until remaining === 0.
export async function triageResearchChunkAction(runId: string): Promise<{
  processed: number; kept: number; rejected: number; remaining: number;
}> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  const r = await triagePapersChunk(runId);
  revalidatePath('/research');
  return r;
}

export async function completeResearchRunAction(runId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  const pending = await countPendingPapers();
  if (pending > 0) {
    throw new Error(`Cannot complete: ${pending} paper${pending === 1 ? '' : 's'} still pending triage.`);
  }
  await m.updateResearchRun(runId, { step: 'complete', status: 'completed' });
  await m.recomputeResearchRunCounts(runId);
  revalidatePath('/research');
}

export async function failResearchRunAction(runId: string, message: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  await m.updateResearchRun(runId, { status: 'failed', error: String(message ?? '').slice(0, 500) });
  revalidatePath('/research');
}

export async function pendingResearchTriageCountAction(runId: string): Promise<number> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  return countPendingPapers();
}

// The review decision — the human gate on the research funnel. Tracking a paper
// REQUIRES a why (the rationales discipline applied to papers).
const PAPER_REVIEWS: PaperReviewStatus[] = ['pending', 'noted', 'tracked', 'dismissed'];
export async function reviewPaperAction(
  paperId: string, status: string, note: string
): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  if (!(PAPER_REVIEWS as string[]).includes(status)) throw new Error('Invalid review status.');
  const why = String(note ?? '').trim().slice(0, 1000);
  if (status === 'tracked' && !why) throw new Error('Tracking a paper requires a why.');
  await m.setPaperReview(paperId, status as PaperReviewStatus, why || null);
  revalidatePath('/research');
}

// Manual "Add paper" — the staleness-gap door (and the non-arXiv door: NBER, SSRN,
// lab reports). An arXiv ref auto-fills from the API; anything else needs url+title.
// Enters pre-approved (triage 'kept'): human before the expensive call.
export async function addPaperAction(formData: FormData) {
  await requireAdmin();
  const ref = str(formData, 'ref');
  const url = str(formData, 'url');
  const title = str(formData, 'title');
  const abstract = str(formData, 'abstract');

  if (ref) {
    const arxivId = parseArxivRef(ref);
    if (!arxivId) throw new Error('Could not parse an arXiv id from that link. For non-arXiv papers, use the URL + title fields.');
    const [entry] = await fetchArxivByIds([arxivId]);
    if (!entry) throw new Error(`arXiv returned no metadata for ${arxivId}.`);
    await m.createManualPaper({
      arxiv_id: entry.arxiv_id,
      url: entry.url,
      title: entry.title,
      abstract: entry.abstract,
      authors: entry.authors,
      categories: entry.categories,
      comments: entry.comment,
      published_at: entry.published || null,
      arxiv_version: entry.version,
      arxiv_updated: entry.updated || null,
    });
  } else {
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('A valid http(s) URL is required.');
    if (!title) throw new Error('A title is required for a non-arXiv paper.');
    await m.createManualPaper({ url, title, abstract: abstract || null });
  }
  revalidatePath('/research');
  redirect('/research');
}

// ---- Research phase 2: per-paper analysis, links, promotion -----------------

// Stage 1: fetch + cache the paper's full text in its OWN invocation (full 60s budget
// for the HTML/PDF/reader paths). Failures come back as data; `terminal` tells the
// client a retry cannot succeed.
export async function hydratePaperAction(paperId: string): Promise<{
  ok: boolean; skipped?: boolean; via?: string; error?: string; terminal?: boolean;
}> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  try {
    const r = await hydratePaper(paperId);
    return { ok: true, skipped: r.skipped, via: r.via };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch error';
    const terminal = e instanceof FetchFailure ? e.terminal : false;
    return { ok: false, error: msg, terminal };
  }
}

// Stage 2: the model leg (reads the cached text). Returns failures as data so the
// client sees the real message (thrown server-action errors are redacted in prod).
export async function analyzePaperAction(paperId: string): Promise<{
  ok: boolean; error?: string; status?: number; terminal?: boolean;
  headline?: string; touches?: number; proposedRigor?: number;
}> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  try {
    const r = await analyzePaper(paperId);
    revalidatePath('/research');
    return {
      ok: true,
      headline: r.extraction.headline_claim,
      touches: r.claim_touches.length,
      proposedRigor: r.extraction.proposed_rigor,
    };
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    const msg = e instanceof Error ? e.message : 'analysis error';
    const terminal = status === 400 || status === 413;
    return { ok: false, error: msg, status, terminal };
  }
}

// The rigor prior is the human's number (the model's proposal lives in the extraction).
export async function setPaperRigorAction(formData: FormData) {
  await requireAdmin();
  const paperId = str(formData, 'paper_id');
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  const prior = parsePrior(str(formData, 'rigor_prior'));
  await m.setPaperRigor(paperId, prior);
  revalidatePath('/research');
}

export async function confirmPaperConceptAction(paperId: string, slug: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  const clean = String(slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(clean)) throw new Error('Bad concept slug.');
  await m.confirmPaperConcept(paperId, clean);
  revalidatePath('/research');
}

export async function removePaperConceptAction(paperId: string, slug: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  await m.removePaperConcept(paperId, String(slug ?? '').trim().toLowerCase());
  revalidatePath('/research');
}

const THREAD_RELATIONS_ALLOWED: ThreadRelation[] = ['supports', 'complicates', 'contradicts', 'context'];
export async function placePaperInThreadAction(
  paperId: string, threadSlug: string, relation: string, why: string
): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  const slug = String(threadSlug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new Error('Bad thread slug.');
  if (!(THREAD_RELATIONS_ALLOWED as string[]).includes(relation)) throw new Error('Bad relation.');
  await m.placePaperInThread(paperId, slug, relation as ThreadRelation, String(why ?? '').trim().slice(0, 500) || null);
  revalidatePath('/research');
}

export async function removePaperFromThreadAction(paperId: string, threadSlug: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  await m.removePaperFromThread(paperId, String(threadSlug ?? '').trim().toLowerCase());
  revalidatePath('/research');
}

// Promote a paper to the Signal Board through the SAME pre-approved-candidate path as
// a manual source (triage can still reject; the admin can override; analysis drafts;
// a human publishes). Promotion is ADDITIVE: the paper stays in the research library
// and papers.signal_id links the two.
export async function preparePaperPromotionAction(paperId: string): Promise<{
  status: 'exists' | 'ready';
  signalId?: string;
  candidateId?: string;
  runId?: string;
  triage_status?: TriageStatus;
  reason?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  const paper = await getPaper(paperId);
  if (!paper) throw new Error('Paper not found.');
  if (paper.signal_id) return { status: 'exists', signalId: paper.signal_id };

  const text = promotableText(paper);
  if (text.length < 200) {
    throw new Error('No usable text to analyze: run Analyze (fetch full text) first.');
  }

  // Reuse the paper's curated source when it has one; otherwise ensure a bare source
  // row (the admin sets its reliability prior later, same as pipeline drafts).
  let sourceId = paper.source_id;
  if (!sourceId) {
    sourceId = await m.ensureSource({
      url: paper.url,
      title: paper.title,
      outlet: paper.arxiv_id ? 'arxiv.org' : domainOf(paper.url) || null,
    });
    await m.setPaperSource(paperId, sourceId);
  }

  // Resume an in-flight candidate from a prior attempt rather than creating a second run.
  let candidate = await getCandidateBySourceId(sourceId);
  let runId: string;
  if (candidate && !candidate.signal_id) {
    runId = candidate.run_id;
  } else if (candidate?.signal_id) {
    // A prior promotion already drafted a signal from this source — link and reuse it.
    await m.setPaperSignal(paperId, candidate.signal_id);
    return { status: 'exists', signalId: candidate.signal_id };
  } else {
    runId = await m.createRun('source');
    const candidateId = await m.createSourceCandidate({
      runId,
      sourceId,
      url: paper.url,
      headline: paper.title,
      source_domain: paper.arxiv_id ? 'arxiv.org' : domainOf(paper.url) || null,
      lens: 'capability', // seed only — analysis sets the real lenses
      published_date: paper.published_at,
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

// After the client's analyze step drafts the signal, record the paper<->signal link.
export async function linkPaperToSignalAction(paperId: string, signalId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId) || !UUID_RE.test(signalId)) throw new Error('Bad id.');
  const sig = await getSignal(signalId, true);
  if (!sig) throw new Error('Signal not found.');
  await m.setPaperSignal(paperId, signalId);
  revalidatePath('/research');
}

// Source page -> research library (independent of "Turn into signal"; the same source
// can go through both). Reuses the curated text and seeds rigor from the reliability
// prior. Dedup returns the existing paper (backfilling its source link).
export async function sendSourceToResearchAction(sourceId: string): Promise<{ paperId: string; existed: boolean }> {
  await requireAdmin();
  if (!UUID_RE.test(sourceId)) throw new Error('Bad source id.');
  const data = await getSource(sourceId);
  if (!data) throw new Error('Source not found.');
  const src = data.source;
  const url = src.url || `urn:source:${sourceId}`;
  const res = await m.createManualPaper({
    arxiv_id: src.url ? parseArxivRef(src.url) : null,
    url,
    title: src.title || 'Untitled source',
    source_id: sourceId,
    published_at: src.published_at ? new Date(src.published_at).toISOString().slice(0, 10) : null,
    raw_content: src.raw_text || null,
    fetched_via: src.raw_text ? 'source' : null,
    rigor_prior: src.reliability_prior ?? null,
  });
  revalidatePath('/research');
  return { paperId: res.id, existed: res.existed };
}

// ---- Research phase 3: threads as living pages ------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

// Rewrite a thread's living synthesis from its confirmed papers (one bounded call;
// every rewrite lands in thread_revisions). Admin-clicked only, never automatic.
export async function updateThreadSynthesisAction(slug: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const clean = String(slug ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(clean)) throw new Error('Bad thread slug.');
  try {
    const r = await updateThreadSynthesis(clean, 'manual update from the thread page');
    if (r.ok) revalidatePath('/research');
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'synthesis error' };
  }
}

export async function setThreadStatusAction(slug: string, status: string): Promise<void> {
  await requireAdmin();
  const clean = String(slug ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(clean)) throw new Error('Bad thread slug.');
  const allowed: ThreadStatus[] = ['open', 'settled', 'dormant'];
  if (!(allowed as string[]).includes(status)) throw new Error('Bad status.');
  const thread = await getThreadBySlug(clean);
  if (!thread) throw new Error('Thread not found.');
  await m.setThreadStatus(thread.id, status as ThreadStatus);
  revalidatePath('/research');
}

// Human-commit for a thread (from the scan panel or the manual form).
export async function createThreadAction(slug: string, title: string, question: string): Promise<void> {
  await requireAdmin();
  const cleanSlug = String(slug ?? '').trim().toLowerCase();
  const cleanTitle = String(title ?? '').trim().slice(0, 120);
  const cleanQuestion = String(question ?? '').trim().slice(0, 400);
  if (!SLUG_RE.test(cleanSlug)) throw new Error('Slug must be short kebab-case (a-z, 0-9, hyphens).');
  if (!cleanTitle || !cleanQuestion) throw new Error('A title and a question are required.');
  await m.createThread(cleanSlug, cleanTitle, cleanQuestion);
  // Creating a thread consumes its scan recommendation, if one exists.
  const scan = await getThreadScan();
  if (scan) {
    const rest = scan.recommendations.filter((r) => r.slug !== cleanSlug);
    await m.saveThreadScan(rest.length ? { ...scan, recommendations: rest } : null);
  }
  revalidatePath('/research');
}

export async function createThreadFormAction(formData: FormData) {
  await createThreadAction(str(formData, 'slug'), str(formData, 'title'), str(formData, 'question'));
}

// The thread gap scan: recommend-only, persists in the singleton, restraint-biased.
export async function diagnoseThreadGapsAction(): Promise<ResearchThreadScan> {
  await requireAdmin();
  const scan = await diagnoseThreadGaps();
  revalidatePath('/research');
  return scan;
}

export async function dismissThreadRecommendationAction(slug: string): Promise<void> {
  await requireAdmin();
  const scan = await getThreadScan();
  if (!scan) return;
  const rest = scan.recommendations.filter((r) => r.slug !== String(slug ?? '').trim().toLowerCase());
  await m.saveThreadScan(rest.length ? { ...scan, recommendations: rest } : null);
  revalidatePath('/research');
}

export async function clearThreadScanAction(): Promise<void> {
  await requireAdmin();
  await m.saveThreadScan(null);
  revalidatePath('/research');
}

// ---- Research phase 4: citation self-correction ------------------------------

// In-session refresh (a button, never a cron): batch POSTs to Semantic Scholar,
// no AI cost. Includes recent rejects on purpose — the "rising rejects" surface
// is the funnel admitting the field disagrees with it.
export async function refreshCitationsAction(): Promise<{ checked: number; updated: number }> {
  await requireAdmin();
  const r = await refreshCitations();
  revalidatePath('/research');
  return r;
}

export async function requeuePaperAction(paperId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(paperId)) throw new Error('Bad paper id.');
  await m.requeuePaper(paperId);
  revalidatePath('/research');
}

// ---- Queue agent (research console; recommend-only, human commits) ----------
export async function recommendQueueChunkAction(ids: string[]): Promise<{
  ok: boolean; processed?: number; tracked?: number; noted?: number; dismissed?: number; error?: string;
}> {
  await requireAdmin();
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every((i) => UUID_RE.test(i))) {
    return { ok: false, error: 'Bad chunk.' };
  }
  try {
    const r = await recommendQueueChunk(ids);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Agent call failed.' };
  }
}

export async function saveSteeringNoteAction(text: string): Promise<void> {
  await requireAdmin();
  await m.saveSteeringNote(String(text ?? '').trim().slice(0, 1500) || null);
  revalidatePath('/research/console');
}

export async function acceptAgentRecommendationsAction(decision: string): Promise<{ ids: string[] }> {
  await requireAdmin();
  if (!['tracked', 'noted', 'dismissed'].includes(decision)) throw new Error('Bad decision.');
  const ids = await m.acceptAgentRecommendations(decision as 'tracked' | 'noted' | 'dismissed');
  revalidatePath('/research');
  revalidatePath('/research/console');
  return { ids };
}

// ---- Research engine (migration 0046) ---------------------------------------
// The day-keyed checkpointed engine (lib/research/engine.ts): the cron route
// is the scheduled driver, this backs a future console's manual tick. Always
// operates on TODAY's run (day-keyed, singleton per UTC day) rather than a
// client-held run id. Failures return as DATA (never thrown): production
// server actions redact thrown messages, and the console needs the real note
// (the scanTickAction pattern).
export async function researchTickAction(): Promise<
  (ResearchProgress & { busy?: boolean; error?: string }) | { error: string }
> {
  await requireAdmin();
  const { runId, day } = await getOrCreateTodayResearchRun();
  const run = await getResearchRun(runId);
  if (!run) return { error: 'Run not found.' };
  if (!(await claimResearchRun(runId))) {
    return {
      runId, day: run.day, step: run.step, done: run.status === 'completed',
      counters: {
        scanned: run.scanned_count, pulled: run.pulled_count,
        kept: run.kept_count, rejected: run.rejected_count,
        agentProcessed: 0, analyzed: 0,
      },
      notes: [], busy: true,
    };
  }
  try {
    const progress = await advanceResearchRun(runId, Date.now() + 50_000);
    revalidatePath('/research/console');
    return progress;
  } catch (e) {
    const msg = String((e as Error)?.message ?? 'research error');
    await m.failResearchRun(runId, msg).catch(() => {});
    return { day, done: false, error: msg };
  }
}

export async function setResearchEnabledAction(enabled: boolean): Promise<void> {
  await requireAdmin();
  await m.setResearchEnabled(Boolean(enabled));
  revalidatePath('/research/console');
}

// The console's model pickers: triageModel (a single utility model) and
// analysisModels (the A/B picker selection), each validated against the
// shared scan enrichment registry (which already carries 'claude-haiku-4-5'
// as its Anthropic baseline entry) — the setScanEnrichModelsAction pattern.
// Either field may be omitted to leave the other picker's selection alone.
export async function setResearchModelsAction(
  opts: { triageModel?: string | null; analysisModels?: string[] }
): Promise<void> {
  await requireAdmin();
  const clean: { triageModel?: string | null; analysisModels?: string[] } = {};
  if (opts.triageModel !== undefined) {
    clean.triageModel = opts.triageModel && isScanEnrichModel(opts.triageModel) ? opts.triageModel : null;
  }
  if (opts.analysisModels !== undefined) {
    const models = [...new Set((opts.analysisModels ?? []).map(String))].filter(isScanEnrichModel);
    if (models.length > 8) throw new Error('Too many models selected.');
    clean.analysisModels = models;
  }
  await m.setResearchModels(clean);
  revalidatePath('/research/console');
}

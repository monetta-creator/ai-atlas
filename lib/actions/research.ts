'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import {
  getSource, getCandidate, getCandidateBySourceId, getSignal, getPaper, getThreadBySlug, getThreadScan } from '../data';
import { triageChunk } from '../pipeline/triage';
import { domainOf, FetchFailure } from '../text';
import { hydratePaper, analyzePaper, promotableText } from '../research/analysis';
import { recommendQueueChunk } from '../research/queue-agent';
import { updateThreadSynthesis } from '../research/synthesis';
import { diagnoseThreadGaps } from '../research/thread-scan';
import type {
  TriageStatus,
  PaperReviewStatus, ThreadRelation, ThreadStatus, ResearchThreadScan,
  } from '../types';
import { UUID_RE, parsePrior, requireAdmin, str } from './shared';

// ===== Research section =====================================================
// The arXiv pull funnel is gone (no outbound web inside the walls): papers enter
// by hand (addPaperAction) or from a curated source (sendSourceToResearchAction),
// pre-approved. Review, analysis, threads, and promotion stay.

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

// Manual "Add paper": url + title (+ optional abstract). Enters pre-approved
// (triage 'kept'): a human chose it. Text arrives via a linked source.
export async function addPaperAction(formData: FormData) {
  await requireAdmin();
  const url = str(formData, 'url');
  const title = str(formData, 'title');
  const abstract = str(formData, 'abstract');

  if (!url || !/^https?:\/\//i.test(url)) throw new Error('A valid http(s) URL is required.');
  if (!title) throw new Error('A title is required.');
  await m.createManualPaper({ url, title, abstract: abstract || null });
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

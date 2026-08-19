'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import {
  getTargets, getStanceOptions,
  getAllDomainRows, getThesis, getLatestThesisRun } from '../data';
import { buildThesisPack } from '../thesis/retrieve';
import { mapThesisToClaims, type ThesisMappingProposal } from '../thesis/map';
import { generateThesisSections, generateThesisBottomLine, type ThesisSectionsOut } from '../thesis/generate';
import { gateThesisNarrative } from '../thesis/citations';
import { recommendClaimEdges, recommendBridgeFeeders } from '../argument-nodes';
import { validateGapRecommendations } from '../gaps-core';
import { diagnoseThesisGaps } from '../thesis/gaps';
import type {
  ClaimEdgeRecommendation, BridgeFeederRecommendation,
  ArgumentGapScan,
  ThesisPack, ThesisNarrative, ThesisStatus,
  } from '../types';
import { UUID_RE, requireAdmin } from './shared';

// ---- Thesis-scoped gap diagnosis (the deal workflow's step 3; migration 0036) ----
// One bounded model call reads a single thesis, its mapped claims, and the pack
// signals that matched its text without touching a mapped claim, and argues for
// the claims/bridges the THESIS depends on that the map lacks. Same shared code
// gate (lib/gaps-core.ts) as the map-wide scan, persisted on the thesis row.

export async function diagnoseThesisGapsAction(thesisId: string): Promise<ArgumentGapScan> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) throw new Error('Bad thesis id.');
  const thesis = await getThesis(thesisId);
  if (!thesis) throw new Error('Thesis not found.');

  const [{ questions, stances, claims, bridges }, pack] = await Promise.all([
    getAllDomainRows(),
    // Deterministic, no AI: the same retrieval the report runs on, used here only
    // as grounding (nothing from this build persists).
    buildThesisPack({ id: thesis.id, statement: thesis.statement, claim_codes: thesis.claim_codes }, null),
  ]);
  const slugByQid = new Map(questions.map((qn) => [qn.id, qn.slug]));
  const nonFrameClaims = claims.filter((c) => !c.is_frame);

  // Unexplained signals: matched the thesis text, touch no mapped claim. Their
  // pack S-tags are the citation labels, so grounding resolves to real signal ids.
  const unexplained = pack.signals.filter((s) => !s.matched_via.includes('claim')).slice(0, 25);
  const signalByLabel = new Map(unexplained.map((s) => [s.tag, s.id]));

  const mappedSet = new Set(thesis.claim_codes);
  const mappedClaims = [
    ...nonFrameClaims.filter((c) => mappedSet.has(c.code)).map((c) => ({
      code: c.code, kind: 'claim' as const, statement: c.statement, test: c.test,
    })),
    ...bridges.filter((b) => mappedSet.has(b.code)).map((b) => ({
      code: b.code, kind: 'bridge' as const, statement: b.statement, test: b.test,
    })),
  ];

  const raw = await diagnoseThesisGaps(
    { statement: thesis.statement, mappedClaims },
    {
      questions: questions.map((qn) => ({ slug: qn.slug, sort: qn.sort_order, title: qn.title })),
      stances: stances.map((s) => ({ code: s.code, title: s.title, question_slug: slugByQid.get(s.question_id) ?? '' })),
      claims: nonFrameClaims.map((c) => ({ code: c.code, statement: c.statement, test: c.test, domain: c.domain })),
      bridges: bridges.map((b) => ({ code: b.code, statement: b.statement, domain_from: b.domain_from, domain_to: b.domain_to })),
    },
    unexplained.map((s) => ({ label: s.tag, title: s.title, summary: s.summary ?? '' }))
  );

  const recommendations = validateGapRecommendations(raw, {
    liveCodes: new Set([...nonFrameClaims, ...bridges].map((t) => t.code)),
    stanceCodes: new Set(stances.map((s) => s.code)),
    bridgeCodes: new Set(bridges.map((b) => b.code)),
    claimCodes: new Set(nonFrameClaims.map((c) => c.code)),
    questionSlugByStance: new Map(stances.map((s) => [s.code, slugByQid.get(s.question_id) ?? ''])),
    liveStatements: [...nonFrameClaims.map((c) => c.statement), ...bridges.map((b) => b.statement)],
    signalByLabel,
    // The thesis scan's grounding can be the thesis's own uncovered leg (the
    // finding); matched-signal citations strengthen but are not required.
    requireRef: false,
  });

  const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveThesisGapScan(thesisId, scan); // empty scan clears the column
  revalidatePath(`/theses/${thesisId}`);
  revalidatePath('/map');
  return scan;
}

export async function dismissThesisGapAction(thesisId: string, code: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) return;
  const c = String(code ?? '').trim();
  if (!c) return;
  const thesis = await getThesis(thesisId);
  const scan = thesis?.gap_scan ?? null;
  if (!scan) return;
  const recommendations = scan.recommendations.filter((r) => r.code !== c);
  await m.saveThesisGapScan(thesisId, recommendations.length ? { ...scan, recommendations } : null);
  revalidatePath(`/theses/${thesisId}`);
}

export async function clearThesisGapScanAction(thesisId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) return;
  await m.saveThesisGapScan(thesisId, null);
  revalidatePath(`/theses/${thesisId}`);
}

// Recommend which stances/bridges a draft claim bears on (advisory; returns to the
// client, no DB write — same gate as recommendConceptClaimsAction). Scoped to the
// host question's stances plus all bridges.
export async function recommendClaimEdgesAction(input: {
  statement: string; test: string; questionSlug: string;
}): Promise<ClaimEdgeRecommendation[]> {
  await requireAdmin();
  const statement = (input?.statement ?? '').trim();
  if (!statement) return [];
  const stances = (await getStanceOptions()).filter((s) => s.question_slug === input.questionSlug);
  const { bridges } = await getTargets();
  return recommendClaimEdges(
    { statement, test: (input.test ?? '').trim() },
    stances.map((s) => ({ code: s.code, title: s.title })),
    bridges.map((b) => ({ code: b.code, statement: b.statement }))
  );
}

// Recommend which claims feed a draft bridge-claim (advisory; returns to the client).
export async function recommendBridgeFeedersAction(input: {
  statement: string; test: string;
}): Promise<BridgeFeederRecommendation[]> {
  await requireAdmin();
  const statement = (input?.statement ?? '').trim();
  if (!statement) return [];
  const { claims } = await getTargets();
  return recommendBridgeFeeders(
    { statement, test: (input.test ?? '').trim() },
    claims.map((c) => ({ code: c.code, statement: c.statement }))
  );
}

// ---- Thesis reports (migration 0027) ----------------------------------------
// The claim-in, cited-report-out surface. Admin-only end to end (a saved report is
// what goes public, via /thesis-report/[id]). All AI steps are typed-arg actions
// returning data (errors as data, like the report generator, so the client can
// retry a failed leg on a fresh invocation); the writes go through lib/mutations
// and refuse dangling codes.

const THESIS_STATEMENT_MAX = 500;
const THESIS_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,11}$/;

function cleanThesisInput(input: { statement: string; claimCodes: string[]; mappingNote?: string | null }) {
  const statement = (input.statement || '').trim().slice(0, THESIS_STATEMENT_MAX);
  if (!statement) throw new Error('A thesis statement is required.');
  const codes = [...new Set((Array.isArray(input.claimCodes) ? input.claimCodes : [])
    .map((c) => String(c).trim())
    .filter((c) => THESIS_CODE_RE.test(c)))];
  const mappingNote = (input.mappingNote || '').trim().slice(0, 2000) || null;
  return { statement, claim_codes: codes, mapping_note: mappingNote };
}

// Recommend-only: propose the claims a free-text thesis bears on. No DB write; the
// admin confirms codes in the form, and the writer re-validates them.
export async function mapThesisAction(
  statement: string
): Promise<{ ok: true; proposals: ThesisMappingProposal[]; note: string } | { ok: false; error: string }> {
  await requireAdmin();
  const s = (statement || '').trim().slice(0, THESIS_STATEMENT_MAX);
  if (!s) return { ok: false, error: 'Enter a thesis statement first.' };
  try {
    const out = await mapThesisToClaims(s);
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'mapping error' };
  }
}

export async function createThesisAction(
  input: { statement: string; claimCodes: string[]; mappingNote?: string | null }
): Promise<{ id: string }> {
  await requireAdmin();
  const id = await m.createThesis(cleanThesisInput(input));
  revalidatePath('/theses');
  return { id };
}

export async function updateThesisAction(
  id: string,
  input: { statement: string; claimCodes: string[]; mappingNote?: string | null }
): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad thesis id.');
  await m.updateThesis(id, cleanThesisInput(input));
  revalidatePath('/theses');
  revalidatePath(`/theses/${id}`);
}

export async function setThesisStatusAction(id: string, status: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad thesis id.');
  if (status !== 'active' && status !== 'archived') throw new Error('Unknown status.');
  await m.setThesisStatus(id, status as ThesisStatus);
  revalidatePath('/theses');
  revalidatePath(`/theses/${id}`);
}

export async function deleteThesisAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad thesis id.');
  await m.deleteThesis(id);
  revalidatePath('/theses');
}

// The deterministic step: build the frozen evidence pack + stats for a thesis (no
// AI, no persistence — the pack is persisted only by saveThesisReportAction). The
// delta baseline is the thesis's latest saved run.
export async function buildThesisPackAction(
  thesisId: string
): Promise<{ ok: true; pack: ThesisPack } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) throw new Error('Bad thesis id.');
  try {
    const thesis = await getThesis(thesisId);
    if (!thesis) return { ok: false, error: 'Thesis not found.' };
    const prev = await getLatestThesisRun(thesisId);
    const pack = await buildThesisPack(
      { id: thesis.id, statement: thesis.statement, claim_codes: thesis.claim_codes },
      prev
    );
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pack build error' };
  }
}

// Model leg 1: the two body sections, generated over the exact pack the admin just
// previewed (passed back verbatim), citation-gated server-side before returning.
export async function generateThesisSectionsAction(
  thesisId: string,
  pack: ThesisPack
): Promise<{ ok: true; sections: ThesisSectionsOut } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) throw new Error('Bad thesis id.');
  if (!pack || pack.thesis_id !== thesisId || !Array.isArray(pack.signals)) {
    return { ok: false, error: 'Pack does not match this thesis. Rebuild the evidence pack.' };
  }
  try {
    const sections = await generateThesisSections(pack);
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'section generation error' };
  }
}

// Model leg 2: bottom line + editorial title, written over the drafted sections.
export async function generateThesisBottomLineAction(
  thesisId: string,
  pack: ThesisPack,
  sections: { readingMd: string; counterweightMd: string }
): Promise<{ ok: true; bottomLineHtml: string; title: string; dropped: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(thesisId)) throw new Error('Bad thesis id.');
  if (!pack || pack.thesis_id !== thesisId) {
    return { ok: false, error: 'Pack does not match this thesis. Rebuild the evidence pack.' };
  }
  try {
    const out = await generateThesisBottomLine(pack, {
      readingMd: String(sections?.readingMd ?? ''),
      counterweightMd: String(sections?.counterweightMd ?? ''),
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'bottom-line generation error' };
  }
}

// Freeze a run: re-gate the narrative against the pack at the save boundary (the
// client's HTML is never trusted), re-derive signal_ids from the pack, insert an
// immutable thesis_reports row. Returns the public /thesis-report id.
export async function saveThesisReportAction(input: {
  thesisId: string;
  title: string;
  pack: ThesisPack;
  narrative: { reading: string | null; counterweight: string | null; bottomLine: string | null };
}): Promise<{ id: string }> {
  await requireAdmin();
  if (!UUID_RE.test(input.thesisId)) throw new Error('Bad thesis id.');
  const thesis = await getThesis(input.thesisId);
  if (!thesis) throw new Error('Thesis not found.');
  const pack = input.pack;
  if (!pack || pack.thesis_id !== input.thesisId || !Array.isArray(pack.signals) || !pack.stats) {
    throw new Error('Pack does not match this thesis. Rebuild the evidence pack.');
  }
  if (JSON.stringify(pack).length > 2_000_000) throw new Error('Pack too large to save.');
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled thesis report';
  const narrative: ThesisNarrative = gateThesisNarrative(input.narrative, pack);
  const signal_ids = pack.signals.map((s) => s.id).filter((id) => UUID_RE.test(id));
  const generated_at =
    typeof pack.generated_at === 'string' && !Number.isNaN(Date.parse(pack.generated_at))
      ? pack.generated_at
      : new Date().toISOString();
  const id = await m.saveThesisReport({
    thesis_id: input.thesisId,
    title,
    statement: pack.statement || thesis.statement,
    pack,
    narrative,
    signal_ids,
    generated_at,
  });
  revalidatePath('/theses');
  revalidatePath(`/theses/${input.thesisId}`);
  return { id };
}

export async function deleteThesisReportAction(id: string, thesisId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id) || !UUID_RE.test(thesisId)) throw new Error('Bad id.');
  await m.deleteThesisReport(id);
  revalidatePath('/theses');
  revalidatePath(`/theses/${thesisId}`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import {
  getTargets, getHypothesisById, getLatestHypothesisRun,
  getRecentReports, getSignals, getArgumentGapScan } from '../data';
import { buildHypothesisPack } from '../hypothesis/retrieve';
import { generateHypothesisSections, generateHypothesisBottomLine, type HypothesisSectionsOut } from '../hypothesis/generate';
import { gateHypothesisNarrative } from '../hypothesis/citations';
import { diagnoseArgumentGaps, diagnoseHypothesisGaps, htmlToText } from '../argument-gaps';
import { validateGapRecommendations } from '../gaps-core';
import type {
  ArgumentGapScan, HypothesisStatus, Resolvability,
  HypothesisPack, HypothesisNarrative,
  } from '../types';
import { UUID_RE, requireAdmin, str } from './shared';

// ---- Hypothesis authoring (create / edit / link) -----------------------------

const STATEMENT_MAX = 800;
const RESOLVABILITIES: Resolvability[] = ['clean', 'slow', 'qualitative'];

function cleanHypothesisInput(fd: FormData) {
  const statement = str(fd, 'statement').slice(0, STATEMENT_MAX);
  const test = str(fd, 'test').slice(0, 2000);
  if (!statement) throw new Error('A hypothesis statement is required.');
  if (!test) throw new Error('A falsification test is required: what evidence would move it?');
  const note = str(fd, 'note').slice(0, 2000) || null;
  const resolvabilityRaw = str(fd, 'resolvability');
  const resolvability = (RESOLVABILITIES as string[]).includes(resolvabilityRaw)
    ? (resolvabilityRaw as Resolvability) : null;
  return { statement, test, note, resolvability };
}

export async function createHypothesisAction(formData: FormData) {
  await requireAdmin();
  const input = cleanHypothesisInput(formData);
  const { code } = await m.createHypothesis(input);
  // The create-from-gap loop closure: creating from a gap recommendation
  // consumes it from the persisted scan (matched by proposed code).
  const gapCode = str(formData, 'gap_code');
  if (gapCode) {
    const scan = await getArgumentGapScan();
    if (scan) {
      const rest = scan.recommendations.filter((r) => r.code !== gapCode);
      await m.saveArgumentGapScan(rest.length ? { ...scan, recommendations: rest } : null);
    }
    // A per-hypothesis scan's draft carries the auditing hypothesis's id; link
    // the new hypothesis back to it (promote-and-link).
    const fromId = str(formData, 'from_hypothesis_id');
    if (UUID_RE.test(fromId)) {
      const from = await getHypothesisById(fromId);
      if (from) {
        const created = await getTargets();
        const mine = created.hypotheses.find((h) => h.code === code);
        if (mine) await m.linkHypotheses(fromId, mine.id, 'promoted from gap scan');
        const scanOn = from.gap_scan ?? null;
        if (scanOn) {
          const rest = scanOn.recommendations.filter((r) => r.code !== gapCode);
          await m.saveHypothesisGapScan(fromId, rest.length ? { ...scanOn, recommendations: rest } : null);
        }
      }
    }
  }
  revalidatePath('/', 'layout');
  redirect(`/hypothesis/${code}`);
}

export async function updateHypothesisAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad hypothesis id.');
  await m.updateHypothesis(id, cleanHypothesisInput(formData));
  const h = await getHypothesisById(id);
  revalidatePath('/', 'layout');
  redirect(h ? `/hypothesis/${h.code}` : '/map');
}

export async function setHypothesisStatusAction(id: string, status: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad hypothesis id.');
  if (!['active', 'retired', 'resolved'].includes(status)) throw new Error('Unknown status.');
  await m.updateHypothesis(id, { status: status as HypothesisStatus });
  revalidatePath('/', 'layout');
}

export async function deleteHypothesisAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad hypothesis id.');
  await m.deleteHypothesis(id);
  revalidatePath('/', 'layout');
  redirect('/map');
}

export async function linkHypothesesAction(fromId: string, toCode: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!UUID_RE.test(fromId)) return { ok: false, error: 'Bad hypothesis id.' };
  const { hypotheses } = await getTargets();
  const to = hypotheses.find((h) => h.code === String(toCode ?? '').trim());
  if (!to) return { ok: false, error: 'No hypothesis with that code.' };
  if (to.id === fromId) return { ok: false, error: 'A hypothesis cannot link to itself.' };
  await m.linkHypotheses(fromId, to.id, null);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function unlinkHypothesesAction(fromId: string, toId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(fromId) || !UUID_RE.test(toId)) throw new Error('Bad id.');
  await m.unlinkHypotheses(fromId, toId);
  revalidatePath('/', 'layout');
}

// ---- Gap diagnoses (recommend-only; the form submit is the sole writer) ------

// The atlas-wide scan: grounded on recent reports + recent signals (signals that
// touch NO hypothesis are the sharpest gap evidence).
export async function diagnoseArgumentGapsAction(): Promise<ArgumentGapScan> {
  await requireAdmin();
  const [{ hypotheses }, reports, signals] = await Promise.all([
    getTargets(),
    getRecentReports(2),
    getSignals({ admin: false }),
  ]);
  const recent = signals.slice(0, 40);
  const reportRefs = reports.map((r, i) => ({
    label: `R${i + 1}`,
    id: r.id,
    title: r.title,
    text: htmlToText(r.data?.narrative?.macroSurvey ?? null),
  }));
  const signalRefs = recent.map((s, i) => ({
    label: `S${i + 1}`,
    id: s.id,
    title: s.title,
    summary: s.summary ?? '',
    touches: s.touches ?? [],
  }));

  const raw = await diagnoseArgumentGaps(
    { hypotheses: hypotheses.map((h) => ({ code: h.code, statement: h.statement, test: h.test ?? '' })) },
    {
      reports: reportRefs.map(({ label, title, text }) => ({ label, title, text })),
      signals: signalRefs.map(({ label, title, summary, touches }) => ({ label, title, summary, touches })),
    }
  );
  const recommendations = validateGapRecommendations(raw, {
    liveCodes: new Set(hypotheses.map((h) => h.code)),
    liveStatements: hypotheses.map((h) => h.statement),
    reportByLabel: new Map(reportRefs.map((r) => [r.label, { id: r.id, title: r.title }])),
    signalByLabel: new Map(signalRefs.map((s) => [s.label, s.id])),
    requireRef: true,
  });
  const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveArgumentGapScan(scan);
  revalidatePath('/map');
  return scan;
}

export async function dismissArgumentGapAction(code: string): Promise<void> {
  await requireAdmin();
  const c = String(code ?? '').trim();
  if (!c) return;
  const scan = await getArgumentGapScan();
  if (!scan) return;
  const recommendations = scan.recommendations.filter((r) => r.code !== c);
  await m.saveArgumentGapScan(recommendations.length ? { ...scan, recommendations } : null);
  revalidatePath('/map');
}

export async function clearArgumentGapScanAction(): Promise<void> {
  await requireAdmin();
  await m.saveArgumentGapScan(null);
  revalidatePath('/map');
}

// The per-hypothesis scan: grounded on the hypothesis's own pack; unexplained
// signals (text-matched, not linked as evidence) are the citation corpus.
export async function diagnoseHypothesisGapsAction(hypothesisId: string): Promise<ArgumentGapScan> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) throw new Error('Bad hypothesis id.');
  const hyp = await getHypothesisById(hypothesisId);
  if (!hyp) throw new Error('Hypothesis not found.');

  const [{ hypotheses }, pack] = await Promise.all([
    getTargets(),
    buildHypothesisPack({ id: hyp.id, code: hyp.code, statement: hyp.statement, test: hyp.test }, null),
  ]);

  const unexplained = pack.signals.filter((s) => !s.matched_via.includes('touch')).slice(0, 25);
  const signalByLabel = new Map(unexplained.map((s) => [s.tag, s.id]));

  const raw = await diagnoseHypothesisGaps(
    { code: hyp.code, statement: hyp.statement, test: hyp.test },
    { hypotheses: hypotheses.map((h) => ({ code: h.code, statement: h.statement, test: h.test ?? '' })) },
    unexplained.map((s) => ({ label: s.tag, title: s.title, summary: s.summary ?? '' }))
  );
  const recommendations = validateGapRecommendations(raw, {
    liveCodes: new Set(hypotheses.map((h) => h.code)),
    liveStatements: hypotheses.map((h) => h.statement),
    signalByLabel,
    requireRef: false,
  });
  const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveHypothesisGapScan(hypothesisId, scan);
  revalidatePath(`/hypothesis/${hyp.code}`);
  revalidatePath('/map');
  return scan;
}

export async function dismissHypothesisGapAction(hypothesisId: string, code: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) return;
  const c = String(code ?? '').trim();
  if (!c) return;
  const hyp = await getHypothesisById(hypothesisId);
  const scan = hyp?.gap_scan ?? null;
  if (!scan) return;
  const recommendations = scan.recommendations.filter((r) => r.code !== c);
  await m.saveHypothesisGapScan(hypothesisId, recommendations.length ? { ...scan, recommendations } : null);
  if (hyp) revalidatePath(`/hypothesis/${hyp.code}`);
}

export async function clearHypothesisGapScanAction(hypothesisId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) return;
  await m.saveHypothesisGapScan(hypothesisId, null);
  const hyp = await getHypothesisById(hypothesisId);
  if (hyp) revalidatePath(`/hypothesis/${hyp.code}`);
}

// ---- Hypothesis reports -------------------------------------------------------
// The hypothesis-in, cited-report-out surface. Admin-only end to end (a saved
// report is what goes public, via /hypothesis-report/[id]). All AI steps are
// typed-arg actions returning data (errors as data, so the client can retry a
// failed leg on a fresh invocation); the writes go through lib/mutations.

// The deterministic step: build the frozen evidence pack + stats (no AI, no
// persistence — the pack is persisted only by saveHypothesisReportAction).
export async function buildHypothesisPackAction(
  hypothesisId: string
): Promise<{ ok: true; pack: HypothesisPack } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) throw new Error('Bad hypothesis id.');
  try {
    const hyp = await getHypothesisById(hypothesisId);
    if (!hyp) return { ok: false, error: 'Hypothesis not found.' };
    const prev = await getLatestHypothesisRun(hypothesisId);
    const pack = await buildHypothesisPack(
      { id: hyp.id, code: hyp.code, statement: hyp.statement, test: hyp.test },
      prev
    );
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pack build error' };
  }
}

// Model leg 1: the two body sections, generated over the exact pack the admin
// just previewed (passed back verbatim), citation-gated before returning.
export async function generateHypothesisSectionsAction(
  hypothesisId: string,
  pack: HypothesisPack
): Promise<{ ok: true; sections: HypothesisSectionsOut } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) throw new Error('Bad hypothesis id.');
  if (!pack || pack.hypothesis_id !== hypothesisId || !Array.isArray(pack.signals)) {
    return { ok: false, error: 'Pack does not match this hypothesis. Rebuild the evidence pack.' };
  }
  try {
    const sections = await generateHypothesisSections(pack);
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'section generation error' };
  }
}

// Model leg 2: bottom line + editorial title, written over the drafted sections.
export async function generateHypothesisBottomLineAction(
  hypothesisId: string,
  pack: HypothesisPack,
  sections: { readingMd: string; counterweightMd: string }
): Promise<{ ok: true; bottomLineHtml: string; title: string; dropped: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID_RE.test(hypothesisId)) throw new Error('Bad hypothesis id.');
  if (!pack || pack.hypothesis_id !== hypothesisId) {
    return { ok: false, error: 'Pack does not match this hypothesis. Rebuild the evidence pack.' };
  }
  try {
    const out = await generateHypothesisBottomLine(pack, {
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
// immutable hypothesis_reports row. Returns the public /hypothesis-report id.
export async function saveHypothesisReportAction(input: {
  hypothesisId: string;
  title: string;
  pack: HypothesisPack;
  narrative: { reading: string | null; counterweight: string | null; bottomLine: string | null };
}): Promise<{ id: string }> {
  await requireAdmin();
  if (!UUID_RE.test(input.hypothesisId)) throw new Error('Bad hypothesis id.');
  const hyp = await getHypothesisById(input.hypothesisId);
  if (!hyp) throw new Error('Hypothesis not found.');
  const pack = input.pack;
  if (!pack || pack.hypothesis_id !== input.hypothesisId || !Array.isArray(pack.signals) || !pack.stats) {
    throw new Error('Pack does not match this hypothesis. Rebuild the evidence pack.');
  }
  if (JSON.stringify(pack).length > 2_000_000) throw new Error('Pack too large to save.');
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled hypothesis report';
  const narrative: HypothesisNarrative = gateHypothesisNarrative(input.narrative, pack);
  const signal_ids = pack.signals.map((s) => s.id).filter((id) => UUID_RE.test(id));
  const generated_at =
    typeof pack.generated_at === 'string' && !Number.isNaN(Date.parse(pack.generated_at))
      ? pack.generated_at
      : new Date().toISOString();
  const id = await m.saveHypothesisReport({
    hypothesis_id: input.hypothesisId,
    title,
    statement: pack.statement || hyp.statement,
    pack,
    narrative,
    signal_ids,
    generated_at,
  });
  revalidatePath('/map');
  revalidatePath(`/hypothesis/${hyp.code}`);
  return { id };
}

export async function deleteHypothesisReportAction(id: string, hypothesisId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id) || !UUID_RE.test(hypothesisId)) throw new Error('Bad id.');
  await m.deleteHypothesisReport(id);
  const hyp = await getHypothesisById(hypothesisId);
  revalidatePath('/map');
  if (hyp) revalidatePath(`/hypothesis/${hyp.code}`);
}

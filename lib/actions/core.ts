'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isEditMode, setEditMode, isPreview, setPreview } from '../auth';
import { isValidContentKey, isValidContentValue, CONTENT_MAX_VALUE_LEN } from '../content';
import * as m from '../mutations';
import {
  getSource, getTargets,
  getSignal, getTestsByCodes } from '../data';
import { generateDossier, extractSourceMetadata, recommendHypotheses } from '../dossier';
import { generateSignalAnalysis, type SignalAnalysisTouch } from '../signal-brief';
import type {
  Direction, Weight, SourceMetadata, HypothesisRecommendation,
  } from '../types';
import { DIRECTIONS, UUID_RE, WEIGHTS, parsePrior, requireAdmin, safePath, str } from './shared';

export async function createSourceAction(formData: FormData) {
  await requireAdmin();
  const id = await m.createSource({
    title: str(formData, 'title'),
    author: str(formData, 'author'),
    outlet: str(formData, 'outlet'),
    url: str(formData, 'url'),
    published_at: str(formData, 'published_at') || undefined,
    raw_text: str(formData, 'raw_text'),
    reliability_prior: parsePrior(str(formData, 'reliability_prior')),
  });
  redirect(`/source/${id}`);
}

// The human gate's action: a conviction can never move without its why.
export async function moveConvictionAction(formData: FormData) {
  await requireAdmin();
  const reason = str(formData, 'reason');
  if (!reason) throw new Error('A rationale is required to move a conviction.');
  const newConviction = Number(formData.get('new_conviction'));
  if (Number.isNaN(newConviction) || newConviction < 0 || newConviction > 1) {
    throw new Error('Conviction must be between 0 and 1.');
  }
  const hypothesisId = str(formData, 'hypothesis_id');
  if (!UUID_RE.test(hypothesisId)) throw new Error('Bad hypothesis id.');
  const evidenceId = str(formData, 'evidence_id');
  if (evidenceId && !UUID_RE.test(evidenceId)) throw new Error('Bad evidence id.');
  await m.moveConviction({
    hypothesis_id: hypothesisId,
    new_conviction: newConviction,
    reason,
    evidence_id: evidenceId || null,
  });
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

export async function setPriorAction(formData: FormData) {
  await requireAdmin();
  const sourceId = str(formData, 'source_id');
  await m.setReliabilityPrior(sourceId, parsePrior(str(formData, 'reliability_prior')));
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
}

export async function snapshotAction() {
  await requireAdmin();
  await m.takeSnapshot('manual');
  revalidatePath('/', 'layout');
}

// ---- Admin inline edit mode (editable site text) ----
export type SaveContentState = { ok: boolean; error?: string };

// useActionState-shaped: (prevState, formData) => state. No redirect, so the inline
// editor stays put and the page re-renders with the saved value after revalidation.
export async function saveContentAction(
  _prev: SaveContentState,
  formData: FormData
): Promise<SaveContentState> {
  await requireAdmin();
  const key = str(formData, 'key');
  const value = str(formData, 'value');
  if (!isValidContentKey(key)) return { ok: false, error: 'Invalid content key.' };
  if (!isValidContentValue(value)) {
    return { ok: false, error: `Text must be 1 to ${CONTENT_MAX_VALUE_LEN} characters.` };
  }
  await m.saveContentOverride(key, value);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function toggleEditModeAction() {
  await requireAdmin();
  await setEditMode(!(await isEditMode()));
  revalidatePath('/', 'layout');
}

// Preview-as-guest: see the public share view without signing out. Turning it on
// also turns edit mode off (you can't be editing while pretending to be a guest).
export async function togglePreviewAction() {
  await requireAdmin();
  const on = !(await isPreview());
  await setPreview(on);
  if (on) await setEditMode(false);
  revalidatePath('/', 'layout');
}

export async function generateDossierAction(formData: FormData) {
  await requireAdmin();
  const sourceId = str(formData, 'source_id');
  if (!sourceId) throw new Error('No source specified.');
  const data = await getSource(sourceId);
  if (!data) throw new Error('Source not found.');
  const { source } = data;
  const dossier = await generateDossier({
    title: source.title,
    author: source.author,
    outlet: source.outlet,
    url: source.url,
    published_at: source.published_at,
    raw_text: source.raw_text,
  });
  await m.setDossier(sourceId, dossier);
  revalidatePath('/', 'layout');
  // Default back to the source page; the signal detail page passes its own redirect_to so
  // the dossier button there returns to the signal instead.
  const back = str(formData, 'redirect_to');
  redirect(back ? safePath(back) : `/source/${sourceId}`);
}

// Generate the cached signal analysis (briefing + counterpoint) and store it on the signal.
// One AI call; the page that hosts the button sets maxDuration = 60.
export async function generateSignalAnalysisAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Invalid signal id.');
  const data = await getSignal(id, true);
  if (!data) throw new Error('Signal not found.');
  const { signal, touches } = data;

  // Source text deepens the analysis when present; absent, the model works from the summary
  // and the touched claims (handled in lib/signal-brief).
  let sourceText: string | null = null;
  if (signal.source_id) {
    const src = await getSource(signal.source_id);
    sourceText = src?.source.raw_text ?? null;
  }

  const tests = await getTestsByCodes(signal.touches);
  const analysisTouches: SignalAnalysisTouch[] = touches
    .filter((t) => !t.unresolved)
    .map((t) => ({
      code: t.code,
      statement: t.statement,
      test: tests[t.code] ?? null,
      direction: t.direction ?? null,
    }));

  const analysis = await generateSignalAnalysis({
    title: signal.title,
    summary: signal.summary,
    source_title: signal.source_title ?? null,
    source_text: sourceText,
    touches: analysisTouches,
  });
  await m.setSignalAnalysis(id, analysis.brief, analysis.counterpoint);
  revalidatePath('/', 'layout');
  redirect(`/signals/${id}`);
}

// Change 1 — AI metadata extraction for the add-source form (returns to the client; no DB write).
export async function extractSourceMetadataAction(text: string): Promise<SourceMetadata> {
  await requireAdmin();
  const t = (text || '').trim();
  if (!t) return { title: '', author: '', url: '', published_at: '' };
  return extractSourceMetadata(t);
}

// Recommend (don't attach) which hypotheses this source fits.
export async function recommendHypothesesAction(sourceId: string): Promise<HypothesisRecommendation[]> {
  await requireAdmin();
  if (!sourceId) return [];
  const data = await getSource(sourceId);
  if (!data) return [];
  const { source } = data;
  const { hypotheses } = await getTargets();
  const dossierBlurb = source.dossier
    ? `${source.dossier.document_internal?.thesis ?? ''} ${source.dossier.document_internal?.what_its_selling ?? ''}`
    : '';
  const text = (source.raw_text || '').trim() || dossierBlurb.trim();
  return recommendHypotheses(
    { text, title: source.title, author: source.author, outlet: source.outlet },
    hypotheses.map((c) => ({ code: c.code, statement: c.statement, test: c.test ?? null }))
  );
}

// Attach one source as evidence to many hypotheses at once. The client
// serializes the selected items into a JSON `payload` field.
export async function addEvidenceBulkAction(formData: FormData) {
  await requireAdmin();
  const sourceId = str(formData, 'source_id');
  if (!sourceId) throw new Error('No source specified.');
  let parsed: { hypothesis_id: string; direction: string; confidence: string; note?: string }[] = [];
  try {
    parsed = JSON.parse(str(formData, 'payload') || '[]');
  } catch {
    parsed = [];
  }
  const excerpt = str(formData, 'excerpt') || undefined;
  const rows = parsed.map((it) => {
    if (!UUID_RE.test(it.hypothesis_id ?? '')) throw new Error('Missing hypothesis id.');
    if (!DIRECTIONS.includes(it.direction as Direction)) throw new Error('Invalid direction.');
    if (!WEIGHTS.includes(it.confidence as Weight)) throw new Error('Invalid confidence.');
    return {
      source_id: sourceId,
      hypothesis_id: it.hypothesis_id,
      direction: it.direction as Direction,
      confidence: it.confidence as Weight,
      excerpt,
      note: it.note ? String(it.note).slice(0, 2000) : undefined,
    };
  });
  if (rows.length) {
    await m.addEvidenceMany(rows);
    revalidatePath('/', 'layout');
  }
  redirect(`/source/${sourceId}`);
}

// Change 4 — delete a source entirely (its evidence cascades).
export async function deleteSourceAction(formData: FormData) {
  await requireAdmin();
  const sourceId = str(formData, 'source_id');
  if (!sourceId) throw new Error('No source specified.');
  await m.deleteSource(sourceId);
  revalidatePath('/', 'layout');
  redirect('/ingest');
}

// Repoint one evidence link to a different hypothesis.
export async function reassignEvidenceAction(formData: FormData) {
  await requireAdmin();
  const evidenceId = str(formData, 'evidence_id');
  const sourceId = str(formData, 'source_id');
  const hypothesisId = str(formData, 'hypothesis_id');
  if (!UUID_RE.test(hypothesisId) || !evidenceId) throw new Error('Missing data.');
  await m.reassignEvidence(evidenceId, hypothesisId);
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
}

// Change 4 — detach (delete) one evidence link.
export async function deleteEvidenceAction(formData: FormData) {
  await requireAdmin();
  const evidenceId = str(formData, 'evidence_id');
  const sourceId = str(formData, 'source_id');
  if (!evidenceId) throw new Error('Missing evidence.');
  await m.deleteEvidence(evidenceId);
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, isEditMode, setEditMode, isPreview, setPreview } from '../auth';
import { isValidContentKey, isValidContentValue, CONTENT_MAX_VALUE_LEN } from '../content';
import * as m from '../mutations';
import {
  getSource, getTargets, getQuestionSummaryInput,
  getSignal, getTestsByCodes } from '../data';
import { getSupplyChainNode, type ScNodeDetail } from '../supply-chain/data';
import { SC_NODE_BY_SLUG, type RiskLevel } from '../supply-chain/map';
import { generateDossier, extractSourceMetadata, recommendClaims } from '../dossier';
import { generateSignalAnalysis, type SignalAnalysisTouch } from '../signal-brief';
import { generateQuestionSummary } from '../summary';
import { recommendLenses } from '../lens';
import type {
  Direction, Weight, SourceMetadata, ClaimRecommendation, Lens,
  } from '../types';
import {
  DIRECTIONS, UUID_RE, WEIGHTS,
  isUniqueViolation, parsePrior, parseTarget, requireAdmin, requireUuid, safePath, str,
} from './shared';

export async function createSourceAction(formData: FormData) {
  await requireAdmin();
  let id: string;
  try {
    id = await m.createSource({
      title: str(formData, 'title'),
      author: str(formData, 'author'),
      outlet: str(formData, 'outlet'),
      url: str(formData, 'url'),
      published_at: str(formData, 'published_at') || undefined,
      raw_text: str(formData, 'raw_text'),
      domain_tag: str(formData, 'domain_tag') || null,
      reliability_prior: parsePrior(str(formData, 'reliability_prior')),
    });
  } catch (e) {
    // sources.url is unique (0050): a manual add pointed at an already-tracked URL.
    if (isUniqueViolation(e)) throw new Error('A source with that URL already exists.');
    throw e;
  }
  redirect(`/source/${id}`);
}

export async function moveConfidenceAction(formData: FormData) {
  await requireAdmin();
  const reason = str(formData, 'reason');
  if (!reason) throw new Error('A rationale is required to move a confidence.');
  const newConfidence = Number(formData.get('new_confidence'));
  if (Number.isNaN(newConfidence) || newConfidence < 0 || newConfidence > 1) {
    throw new Error('Confidence must be between 0 and 1.');
  }
  const target_type = str(formData, 'target_type');
  if (target_type !== 'claim' && target_type !== 'bridge_claim' && target_type !== 'stance' && target_type !== 'position') {
    throw new Error('Invalid target type.');
  }
  const target_id = requireUuid(formData, 'target_id', 'Target');
  const evidenceId = str(formData, 'evidence_id');
  if (evidenceId && !UUID_RE.test(evidenceId)) throw new Error('Bad evidence id.');
  await m.moveConfidence({
    target_type,
    target_id,
    new_confidence: newConfidence,
    reason,
    evidence_id: evidenceId || null,
  });
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

export async function setPriorAction(formData: FormData) {
  await requireAdmin();
  const sourceId = requireUuid(formData, 'source_id', 'Source');
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

// ---- Direct domain-text edits (the /data editor) ----
export type UpdateFieldState = { ok: boolean; error?: string };

// useActionState-shaped, like saveContentAction, but it writes straight to the
// domain row (questions/stances/claims/bridge_claims) through the registry-guarded
// writer. table/column are validated against the same registry the mutation uses
// (m.isEditableDomainField) so the two layers can't drift; value/id are parameterized.
export async function updateDomainFieldAction(
  _prev: UpdateFieldState,
  formData: FormData
): Promise<UpdateFieldState> {
  await requireAdmin();
  const table = str(formData, 'table');
  const id = str(formData, 'id');
  const column = str(formData, 'column');
  const value = str(formData, 'value');
  if (!UUID_RE.test(id)) return { ok: false, error: 'Bad record id.' };
  if (!m.isEditableDomainField(table, column)) return { ok: false, error: 'Field not editable.' };
  if (value.length > 8000) return { ok: false, error: 'Text must be under 8000 characters.' };
  try {
    await m.updateDomainField(table, id, column, value);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function generateDossierAction(formData: FormData) {
  await requireAdmin();
  const sourceId = requireUuid(formData, 'source_id', 'Source');
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

  const tests = await getTestsByCodes(signal.claim_touches);
  const analysisTouches: SignalAnalysisTouch[] = touches
    .filter((t) => !t.unresolved)
    .map((t) => ({
      code: t.code,
      type: t.type,
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
  if (!t) return { title: '', author: '', url: '', published_at: '', domain_tag: '' };
  return extractSourceMetadata(t);
}

// Supply-chain node detail for the drawer (read). No requireAdmin: it resolves `personal`
// itself, so a guest gets the published-only signals and no admin note. The slug must
// exist in the static map (the firewall against a forged slug).
export async function getSupplyChainNodeAction(slug: string): Promise<ScNodeDetail | null> {
  if (typeof slug !== 'string' || !SC_NODE_BY_SLUG.has(slug)) return null;
  const admin = await isAdmin();
  const preview = await isPreview();
  return getSupplyChainNode(slug, admin && !preview);
}

const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

// Set a node's risk override (empty = clear to the stub default) and admin note.
export async function setSupplyChainNodeMetaAction(slug: string, risk: string, note: string): Promise<void> {
  await requireAdmin();
  if (!SC_NODE_BY_SLUG.has(slug)) throw new Error('Unknown node.');
  let risk_level: RiskLevel | null = null;
  if (risk !== '') {
    if (!(RISK_LEVELS as string[]).includes(risk)) throw new Error('Invalid risk level.');
    risk_level = risk as RiskLevel;
  }
  const admin_note = (note || '').trim().slice(0, 2000) || null;
  await m.setSupplyChainNodeMeta(slug, { risk_level, admin_note });
  revalidatePath('/', 'layout');
}

export async function linkSignalToNodeAction(slug: string, signalId: string): Promise<void> {
  await requireAdmin();
  if (!SC_NODE_BY_SLUG.has(slug)) throw new Error('Unknown node.');
  if (!UUID_RE.test(signalId)) throw new Error('That does not look like a signal id.');
  await m.linkSignalToNode(slug, signalId);
  revalidatePath('/', 'layout');
}

export async function unlinkSignalFromNodeAction(slug: string, signalId: string): Promise<void> {
  await requireAdmin();
  if (!SC_NODE_BY_SLUG.has(slug)) throw new Error('Unknown node.');
  if (!UUID_RE.test(signalId)) throw new Error('That does not look like a signal id.');
  await m.unlinkSignalFromNode(slug, signalId);
  revalidatePath('/', 'layout');
}

// Change 2 — recommend (don't attach) which claims this source fits.
export async function recommendClaimsAction(sourceId: string): Promise<ClaimRecommendation[]> {
  await requireAdmin();
  if (!UUID_RE.test(sourceId)) return [];
  const data = await getSource(sourceId);
  if (!data) return [];
  const { source } = data;
  const { claims } = await getTargets();
  const dossierBlurb = source.dossier
    ? `${source.dossier.document_internal?.thesis ?? ''} ${source.dossier.document_internal?.what_its_selling ?? ''}`
    : '';
  const text = (source.raw_text || '').trim() || dossierBlurb.trim();
  return recommendClaims(
    { text, title: source.title, author: source.author, outlet: source.outlet },
    claims.map((c) => ({ code: c.code, statement: c.statement, test: null }))
  );
}

// Change 3 — attach one source as evidence to many claims/bridges at once.
// The client serializes the selected items into a JSON `payload` field.
export async function addEvidenceBulkAction(formData: FormData) {
  await requireAdmin();
  const sourceId = requireUuid(formData, 'source_id', 'Source');
  let parsed: { target: string; direction: string; weight: string }[] = [];
  try {
    parsed = JSON.parse(str(formData, 'payload') || '[]');
  } catch {
    parsed = [];
  }
  const excerpt = str(formData, 'excerpt') || undefined;
  const rows = parsed.map((it) => {
    const { target_type, target_id } = parseTarget(it.target, ['claim', 'bridge_claim']);
    if (!DIRECTIONS.includes(it.direction as Direction)) throw new Error('Invalid direction.');
    if (!WEIGHTS.includes(it.weight as Weight)) throw new Error('Invalid weight.');
    return {
      source_id: sourceId,
      target_type: target_type as 'claim' | 'bridge_claim',
      target_id,
      direction: it.direction as Direction,
      weight: it.weight as Weight,
      excerpt,
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
  const sourceId = requireUuid(formData, 'source_id', 'Source');
  await m.deleteSource(sourceId);
  revalidatePath('/', 'layout');
  redirect('/ingest');
}

// Change 4 — repoint one evidence link to a different claim/bridge.
export async function reassignEvidenceAction(formData: FormData) {
  await requireAdmin();
  const evidenceId = requireUuid(formData, 'evidence_id', 'Evidence');
  const sourceId = str(formData, 'source_id');
  const { target_type, target_id } = parseTarget(str(formData, 'target'), ['claim', 'bridge_claim']);
  await m.reassignEvidence(evidenceId, target_type as 'claim' | 'bridge_claim', target_id);
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
}

// Change 4 — detach (delete) one evidence link.
export async function deleteEvidenceAction(formData: FormData) {
  await requireAdmin();
  const evidenceId = requireUuid(formData, 'evidence_id', 'Evidence');
  const sourceId = str(formData, 'source_id');
  await m.deleteEvidence(evidenceId);
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
}

// Generate a fresh question-state summary, append it to the per-question log,
// and show the timeline. Metrics are computed in code (input.metrics).
export async function generateQuestionSummaryAction(formData: FormData) {
  await requireAdmin();
  const questionId = requireUuid(formData, 'question_id', 'Question');
  const slug = str(formData, 'slug');
  if (!slug) throw new Error('Missing question.');
  const input = await getQuestionSummaryInput(questionId);
  if (!input) throw new Error('Question not found.');
  const summary = await generateQuestionSummary(input);
  await m.createQuestionSummary(questionId, summary, input.metrics);
  revalidatePath('/', 'layout');
  redirect(`/q/${slug}/summary`);
}

// ---- Lens tagging ----
const LENS_VALUES: Lens[] = ['market', 'economics', 'social', 'employment', 'education', 'geopolitics', 'stack'];

// Toggle one lens on a node. Called directly from the LensTagger client component.
export async function setNodeLensAction(
  targetType: string,
  targetId: string,
  lens: string,
  on: boolean
): Promise<void> {
  await requireAdmin();
  if (targetType !== 'claim' && targetType !== 'bridge_claim' && targetType !== 'stance') {
    throw new Error('Invalid target.');
  }
  if (!UUID_RE.test(targetId)) throw new Error('Bad target id.');
  if (!(LENS_VALUES as string[]).includes(lens)) throw new Error('Unknown lens.');
  if (on) await m.addNodeLens(targetType, targetId, lens);
  else await m.removeNodeLens(targetType, targetId, lens);
  revalidatePath('/', 'layout');
}

// Recommend lenses for a statement (advisory; returns to the client, no DB write).
export async function recommendNodeLensesAction(statement: string): Promise<Lens[]> {
  await requireAdmin();
  return recommendLenses(statement);
}

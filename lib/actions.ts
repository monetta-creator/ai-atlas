'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdmin, isPortal, isEditMode, setEditMode, isPreview, setPreview } from './auth';
import { isValidContentKey, isValidContentValue, CONTENT_MAX_VALUE_LEN } from './content';
import * as m from './mutations';
import {
  getSource, getTargets, getQuestionSummaryInput,
  getLastCompletedRunAt, getApprovedCandidates, getCandidateArchive, getSignalsPage, getDedupeScan,
  listSavedReports, getSavedReport, countPendingCandidates,
  getCandidate, getCandidateBySourceId, getSignalIdBySource, isFetchHostileDomain,
  getConceptGraph, getConceptGapScan, getStanceOptions,
  getAllDomainRows, getRecentReports, getSignals, getArgumentGapScan,
  getSignal, getTestsByCodes,
  getLastResearchRunAt, countPendingPapers, getPaper, getThreadBySlug, getThreadScan,
  getThesis, getLatestThesisRun,
  getTextCoverage, getSignalTextTarget, listSignalsMissingText,
  getScoutVerticals, getCompany, getCompanyDocumentText,
  type TextCoverage, type MissingTextRow,
} from './data';
import { checkPortalBudget } from './portal/budget';
import { buildThesisPack } from './thesis/retrieve';
import { mapThesisToClaims, type ThesisMappingProposal } from './thesis/map';
import { generateThesisSections, generateThesisBottomLine, type ThesisSectionsOut } from './thesis/generate';
import { gateThesisNarrative } from './thesis/citations';
import { buildSheetPack } from './tearsheet/retrieve';
import {
  generateSheetSections, generateSheetClose, gateSheetNarrative, type SheetSectionsOut,
} from './tearsheet/generate';
import { recommendConceptPrereqs, recommendConceptClaims, diagnoseConceptGaps } from './concepts';
import { recommendClaimEdges, recommendBridgeFeeders } from './argument-nodes';
import { diagnoseArgumentGaps, htmlToText } from './argument-gaps';
import { validateGapRecommendations } from './gaps-core';
import { diagnoseThesisGaps } from './thesis/gaps';
import { getSupplyChainNode, type ScNodeDetail } from './supply-chain/data';
import { SC_NODE_BY_SLUG, type RiskLevel } from './supply-chain/map';
import { generateDossier, extractSourceMetadata, recommendClaims } from './dossier';
import { generateSignalAnalysis, type SignalAnalysisTouch } from './signal-brief';
import { generateQuestionSummary } from './summary';
import { recommendLenses } from './lens';
import { buildReportData } from './report';
import { generateLensNarrative, synthesizeReport } from './report-generate';
import { sanitizeReportNarrative } from './sanitize';
import { SIGNAL_LENS_SLUGS } from './format';
import { discoverBatch, discoverBreakingSweep, discoveryPlan, type DiscoveryBatchRef } from './pipeline/discovery';
import { runCoverageCheck } from './pipeline/coverage';
import { triageChunk } from './pipeline/triage';
import { analyzeCandidate } from './pipeline/analysis';
import { domainOf, fetchCandidateText, FetchFailure } from './pipeline/web';
import { dedupeAllDrafts } from './pipeline/dedupe';
import { discoverScoutBatch } from './scout/discovery';
import { scoutPlan, type ScoutBatchRef } from './scout/core';
import { scoreScoutChunk } from './scout/agent';
import { enrichCompany } from './scout/enrich';
import { runIntelSweep } from './scout/intel';
import { extractFromDocument } from './scout/docread';
import { scanCompetitors } from './scout/competitors';
import { pullPage } from './research/pull';
import { triagePapersChunk } from './research/triage';
import { parseArxivRef, fetchArxivByIds } from './research/arxiv';
import { hydratePaper, analyzePaper, promotableText } from './research/analysis';
import { recommendQueueChunk } from './research/queue-agent';
import { updateThreadSynthesis } from './research/synthesis';
import { diagnoseThreadGaps } from './research/thread-scan';
import { refreshCitations } from './research/citations';
import type {
  Direction, Weight, SourceMetadata, ClaimRecommendation, Lens,
  Significance, SignalLens, RunCadence, TriageStatus,
  CandidateArchiveFilters, CandidateArchiveResult,
  SignalsFeedFilters, SignalsPageResult, DedupeRecommendation, Report, SavedReportMeta,
  ConceptStatus, ConceptPrereqRecommendation, ConceptClaimRecommendation,
  ConceptGapScan, ConceptGapRecommendation,
  Domain, Resolvability, Relation,
  ClaimEdgeRecommendation, BridgeFeederRecommendation,
  ArgumentGapScan,
  SheetPack, SheetScope, SheetNarrative,
  PaperReviewStatus, ThreadRelation, ThreadStatus, ResearchThreadScan,
  RunCoverage,
  ThesisPack, ThesisNarrative, ThesisStatus,
  CompanyStatus, CompanyStage, CompanyEventKind,
} from './types';

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error('Unauthorized');
}

// Admin-or-portal gate for the scout research surface: isPortal() admits
// admins implicitly (lib/auth.ts). Portal-permitted actions ALSO re-check the
// target company's visibility and the daily budget; see the gate template on
// intelSweepAction.
async function requirePortal() {
  if (!(await isPortal())) throw new Error('Unauthorized');
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

function parsePrior(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0 || n > 100) throw new Error('Reliability prior must be between 0 and 100.');
  return n;
}

// Only allow same-origin path redirects (no open redirect via a crafted form).
function safePath(p: string): string {
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

const DIRECTIONS: Direction[] = ['supports', 'contradicts', 'neutral'];
const WEIGHTS: Weight[] = ['high', 'medium', 'low'];

export async function createSourceAction(formData: FormData) {
  await requireAdmin();
  const id = await m.createSource({
    title: str(formData, 'title'),
    author: str(formData, 'author'),
    outlet: str(formData, 'outlet'),
    url: str(formData, 'url'),
    published_at: str(formData, 'published_at') || undefined,
    raw_text: str(formData, 'raw_text'),
    domain_tag: str(formData, 'domain_tag') || null,
    reliability_prior: parsePrior(str(formData, 'reliability_prior')),
  });
  redirect(`/source/${id}`);
}

export async function addEvidenceAction(formData: FormData) {
  await requireAdmin();
  const sourceId = str(formData, 'source_id');
  const target = str(formData, 'target'); // "claim:<id>" | "bridge_claim:<id>"
  const sep = target.indexOf(':');
  const target_type = target.slice(0, sep);
  const target_id = target.slice(sep + 1);
  if (target_type !== 'claim' && target_type !== 'bridge_claim') throw new Error('Invalid target.');
  if (!target_id) throw new Error('No target selected.');

  const direction = str(formData, 'direction');
  const weight = str(formData, 'weight');
  if (!DIRECTIONS.includes(direction as Direction)) throw new Error('Invalid direction.');
  if (!WEIGHTS.includes(weight as Weight)) throw new Error('Invalid weight.');

  await m.addEvidence({
    source_id: sourceId,
    target_type,
    target_id,
    direction: direction as Direction,
    weight: weight as Weight,
    excerpt: str(formData, 'excerpt'),
    note: str(formData, 'note'),
  });
  revalidatePath('/', 'layout');
  redirect(`/source/${sourceId}`);
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
  const evidenceId = str(formData, 'evidence_id');
  if (evidenceId && !UUID_RE.test(evidenceId)) throw new Error('Bad evidence id.');
  await m.moveConfidence({
    target_type,
    target_id: str(formData, 'target_id'),
    new_confidence: newConfidence,
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

export async function resetContentAction(
  _prev: SaveContentState,
  formData: FormData
): Promise<SaveContentState> {
  await requireAdmin();
  const key = str(formData, 'key');
  if (!isValidContentKey(key)) return { ok: false, error: 'Invalid content key.' };
  await m.resetContentOverride(key);
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
  if (!sourceId) return [];
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
  const sourceId = str(formData, 'source_id');
  if (!sourceId) throw new Error('No source specified.');
  let parsed: { target: string; direction: string; weight: string }[] = [];
  try {
    parsed = JSON.parse(str(formData, 'payload') || '[]');
  } catch {
    parsed = [];
  }
  const excerpt = str(formData, 'excerpt') || undefined;
  const rows = parsed.map((it) => {
    const sep = it.target.indexOf(':');
    const target_type = it.target.slice(0, sep);
    const target_id = it.target.slice(sep + 1);
    if (target_type !== 'claim' && target_type !== 'bridge_claim') throw new Error('Invalid target.');
    if (!target_id) throw new Error('Missing target id.');
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
  const sourceId = str(formData, 'source_id');
  if (!sourceId) throw new Error('No source specified.');
  await m.deleteSource(sourceId);
  revalidatePath('/', 'layout');
  redirect('/ingest');
}

// Change 4 — repoint one evidence link to a different claim/bridge.
export async function reassignEvidenceAction(formData: FormData) {
  await requireAdmin();
  const evidenceId = str(formData, 'evidence_id');
  const sourceId = str(formData, 'source_id');
  const target = str(formData, 'target');
  const sep = target.indexOf(':');
  const target_type = target.slice(0, sep);
  const target_id = target.slice(sep + 1);
  if (target_type !== 'claim' && target_type !== 'bridge_claim') throw new Error('Invalid target.');
  if (!target_id || !evidenceId) throw new Error('Missing data.');
  await m.reassignEvidence(evidenceId, target_type, target_id);
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

// Generate a fresh question-state summary, append it to the per-question log,
// and show the timeline. Metrics are computed in code (input.metrics).
export async function generateQuestionSummaryAction(formData: FormData) {
  await requireAdmin();
  const questionId = str(formData, 'question_id');
  const slug = str(formData, 'slug');
  if (!questionId || !slug) throw new Error('Missing question.');
  const input = await getQuestionSummaryInput(questionId);
  if (!input) throw new Error('Question not found.');
  const summary = await generateQuestionSummary(input);
  await m.createQuestionSummary(questionId, summary, input.metrics);
  revalidatePath('/', 'layout');
  redirect(`/q/${slug}/summary`);
}

// ---- Cross-cutting positions (the worldview layer) ----
const NODE_TYPES = ['stance', 'claim', 'bridge_claim'] as const;

export async function createPositionAction(formData: FormData) {
  await requireAdmin();
  const statement = str(formData, 'statement');
  if (!statement) throw new Error('A position needs a statement.');
  await m.createPosition(statement);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function updatePositionStatementAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  const statement = str(formData, 'statement');
  if (!UUID_RE.test(id)) throw new Error('Bad position id.');
  if (!statement) throw new Error('A position needs a statement.');
  await m.updatePositionStatement(id, statement);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function deletePositionAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad position id.');
  await m.deletePosition(id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function addPositionComponentAction(formData: FormData) {
  await requireAdmin();
  const positionId = str(formData, 'position_id');
  const target = str(formData, 'target'); // "claim:<id>" | "bridge_claim:<id>" | "stance:<id>"
  const sep = target.indexOf(':');
  const target_type = target.slice(0, sep);
  const target_id = target.slice(sep + 1);
  if (!UUID_RE.test(positionId)) throw new Error('Bad position id.');
  if (!(NODE_TYPES as readonly string[]).includes(target_type)) throw new Error('Invalid target.');
  if (!UUID_RE.test(target_id)) throw new Error('Pick a node to add.');
  await m.addPositionComponent(positionId, target_type as 'stance' | 'claim' | 'bridge_claim', target_id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function removePositionComponentAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'component_id');
  if (!UUID_RE.test(id)) throw new Error('Bad component id.');
  await m.removePositionComponent(id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

// ---- Report generation (Phase 2 — returns to the client; no DB write) -------
// Decomposed so each call fits the 60s cap and one failure can't kill the run: the
// client orchestrates one generateReportLensAction per active lens, then one
// synthesizeReportAction. Both re-derive their data server-side (server is the source of
// truth) and return model errors as data so the client can surface them per-lens.
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateReportLensAction(
  from: string, to: string, lens: string
): Promise<
  | { ok: true; lens: SignalLens; narrative: string; callout: string }
  | { ok: false; lens: SignalLens; error: string }
> {
  await requireAdmin();
  const l = lens as SignalLens;
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  if (!(SIGNAL_LENS_SLUGS as string[]).includes(lens)) throw new Error('Invalid lens.');
  try {
    const data = await buildReportData({ from, to, lenses: [l], personal: true });
    const funnel = data.metrics.perLens[0]?.funnel;
    if (!funnel) return { ok: false, lens: l, error: 'No pipeline data for lens.' };
    const { narrative, callout } = await generateLensNarrative({
      lens: l, range: data.range, signals: data.signals, funnel, touches: data.touches,
    });
    return { ok: true, lens: l, narrative, callout };
  } catch (e) {
    return { ok: false, lens: l, error: e instanceof Error ? e.message : 'generation error' };
  }
}

export async function synthesizeReportAction(
  from: string, to: string, lenses: string[],
  lensSummaries: { lens: string; narrative: string }[]
): Promise<
  | { ok: true; macroSurvey: string; claimsRecap: string; title: string }
  | { ok: false; error: string }
> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_LENS_SLUGS);
  const ls = (Array.isArray(lenses) ? lenses : []).filter((l): l is SignalLens => valid.has(l));
  const summaries = (Array.isArray(lensSummaries) ? lensSummaries : [])
    .filter((s) => s && valid.has(s.lens) && typeof s.narrative === 'string')
    .map((s) => ({ lens: s.lens as SignalLens, narrative: s.narrative }));
  try {
    const data = await buildReportData({ from, to, lenses: ls, personal: true });
    const out = await synthesizeReport({
      range: data.range, lenses: data.lenses, signals: data.signals,
      metrics: data.metrics, touches: data.touches, lensSummaries: summaries,
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'synthesis error' };
  }
}

// Assemble the DATA half of a report for the current controls (so the client's generation
// run is self-consistent with what it generates, independent of the URL/preview scope).
export async function getReportDataAction(
  from: string, to: string, lenses: string[]
): Promise<Report> {
  await requireAdmin();
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) throw new Error('Bad date range.');
  const valid = new Set<string>(SIGNAL_LENS_SLUGS);
  const ls = (Array.isArray(lenses) ? lenses : []).filter((l): l is SignalLens => valid.has(l));
  return buildReportData({ from, to, lenses: ls, personal: true });
}

// ---- Report persistence (admin; sanitizes narrative HTML at the save boundary) ----------
export async function saveReportAction(input: { id?: string; title: string; report: Report }): Promise<{ id: string }> {
  await requireAdmin();
  if (input.id && !UUID_RE.test(input.id)) throw new Error('Bad report id.');
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled report';
  const report = sanitizeReportNarrative(input.report);
  const id = await m.saveReport({ id: input.id, title, report });
  revalidatePath('/reports/period');
  revalidatePath('/reports');
  return { id };
}

export async function listSavedReportsAction(): Promise<SavedReportMeta[]> {
  await requireAdmin();
  return listSavedReports();
}

export async function getSavedReportAction(id: string): Promise<{ id: string; title: string; report: Report } | null> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  return getSavedReport(id);
}

export async function deleteReportAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.deleteReport(id);
  revalidatePath('/reports/period');
  revalidatePath('/reports');
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

// ===== Signal Board =========================================================

const SIGNIFICANCES: Significance[] = ['high', 'medium', 'low'];

function parseStringArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

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

// One bounded attempt to retain the article text behind a signal, stored on
// whichever row the record offers (source row first, else its newest candidate).
// Every failure comes back as data; callers decide whether it matters.
async function retainTextFor(row: MissingTextRow): Promise<{ ok: boolean; reason?: string }> {
  if (!row.url) return { ok: false, reason: 'no url on the record' };
  try {
    const domain = domainOf(row.url).toLowerCase().replace(/^www\./, '');
    const preferJina = domain ? await isFetchHostileDomain(domain).catch(() => false) : false;
    const { text, via } = await fetchCandidateText(row.url, { preferJina, maxChars: 60000 });
    if (row.source_id) await m.setSourceRawText(row.source_id, text);
    else if (row.candidate_id) await m.setCandidateRawContent(row.candidate_id, text, via);
    else return { ok: false, reason: 'no row to store the text on' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'fetch failed' };
  }
}

// Publish / unpublish toggle — visibility only (editorial date is left alone).
// Publishing also runs the retained-text guard: the corpus's 100% coverage is
// protected at the moment a signal enters the public record, with ONE bounded
// fetch if no text is held. Non-fatal by construction — publishing never fails
// because a fetch did; /pipeline's coverage stat is the audit surface.
export async function publishSignalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad signal id.');
  const publishing = str(formData, 'publish') === '1';
  await m.setSignalPublished(id, publishing);
  if (publishing) {
    try {
      const target = await getSignalTextTarget(id);
      if (target) await retainTextFor(target);
    } catch { /* non-fatal: the coverage stat on /pipeline surfaces any gap */ }
  }
  revalidatePath('/', 'layout');
  redirect(safePath(str(formData, 'redirect_to')));
}

// The retained-text catch-up on /pipeline: process up to 5 published signals
// still missing article text, one bounded fetch each (fits the page's 60s cap).
export async function refetchMissingTextAction(): Promise<{
  attempted: number;
  retained: number;
  failures: { title: string; reason: string }[];
  coverage: TextCoverage;
}> {
  await requireAdmin();
  const missing = await listSignalsMissingText(5);
  const failures: { title: string; reason: string }[] = [];
  let retained = 0;
  for (const row of missing) {
    const r = await retainTextFor(row);
    if (r.ok) retained++;
    else failures.push({ title: row.title, reason: (r.reason ?? 'failed').slice(0, 200) });
  }
  revalidatePath('/pipeline');
  return { attempted: missing.length, retained, failures, coverage: await getTextCoverage() };
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

// ===== AI cost monitoring (migration 0014) ==================================
// Add a new pricing card (the /costs dashboard form). useActionState-shaped (like
// saveContentAction): returns the result as data so the form shows an inline error and stays
// put, then revalidates /costs. The effective date is REQUIRED — the form has no default, so
// a card can never silently take effect "today" without the admin choosing the date.
export type AddRateCardState = { ok: boolean; error?: string };

const MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Parse one USD-per-million-tokens rate. Required, finite, 0–100000.
function parseRate(fd: FormData, key: string, label: string): number {
  const raw = str(fd, key);
  if (raw === '') throw new Error(`${label} is required.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new Error(`${label} must be a number between 0 and 100000.`);
  return n;
}

export async function addRateCardAction(
  _prev: AddRateCardState,
  formData: FormData
): Promise<AddRateCardState> {
  await requireAdmin();
  try {
    const model = str(formData, 'model');
    if (!MODEL_RE.test(model)) return { ok: false, error: 'Enter a valid model id (e.g. claude-sonnet-4-6).' };

    const effective_date = str(formData, 'effective_date');
    if (!ISO_DAY_RE.test(effective_date)) {
      return { ok: false, error: 'An explicit effective date (YYYY-MM-DD) is required.' };
    }

    const input_per_mtok = parseRate(formData, 'input_per_mtok', 'Input price');
    const output_per_mtok = parseRate(formData, 'output_per_mtok', 'Output price');
    const cache_write_per_mtok = parseRate(formData, 'cache_write_per_mtok', 'Cache-write price');
    const cache_read_per_mtok = parseRate(formData, 'cache_read_per_mtok', 'Cache-read price');

    const context_window = Number(str(formData, 'context_window'));
    if (!Number.isInteger(context_window) || context_window <= 0 || context_window > 100_000_000) {
      return { ok: false, error: 'Context window must be a positive whole number of tokens.' };
    }

    await m.addRateCard({
      model, effective_date, input_per_mtok, output_per_mtok,
      cache_write_per_mtok, cache_read_per_mtok, context_window,
    });
    revalidatePath('/costs');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not add the rate card.';
    // unique (model, effective_date) → a friendly message instead of a 500.
    if (/duplicate key|unique/i.test(msg)) {
      return { ok: false, error: 'A rate card for that model and effective date already exists.' };
    }
    return { ok: false, error: msg };
  }
}

// ===== Concepts (the semantic scaffold) =====================================

const CONCEPT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONCEPT_STATUSES: ConceptStatus[] = ['settled', 'contested'];

// Read + validate the shared concept fields from the create/edit form. The client
// only ever sends prerequisite IDS and claim CODES — both are re-checked against
// the live lists here, and a claim link's target_type is re-derived server-side
// from the code (never trusted from the wire).
async function readConceptFields(formData: FormData, selfId?: string) {
  const name = str(formData, 'name');
  if (!name || name.length > 120) throw new Error('A concept needs a name (max 120 characters).');
  const slug = str(formData, 'slug').toLowerCase();
  if (!CONCEPT_SLUG_RE.test(slug) || slug.length > 64) {
    throw new Error('Slug must be lowercase letters/numbers separated by hyphens.');
  }
  const short_definition = str(formData, 'short_definition');
  if (!short_definition || short_definition.length > 500) {
    throw new Error('A concept needs a short definition (max 500 characters).');
  }
  const explanation = str(formData, 'explanation');
  if (explanation.length > 8000) throw new Error('Explanation must be under 8000 characters.');
  const status = str(formData, 'status');
  if (!(CONCEPT_STATUSES as string[]).includes(status)) throw new Error('Invalid status.');

  const { concepts } = await getConceptGraph();
  const liveIds = new Set(concepts.map((c) => c.id));
  const prerequisite_ids = Array.from(new Set(
    parseStringArray(str(formData, 'prerequisite_ids'))
      .filter((id) => UUID_RE.test(id) && liveIds.has(id) && id !== selfId)
  ));

  const { claims, bridges } = await getTargets();
  const typeByCode = new Map<string, 'claim' | 'bridge_claim'>(
    [...claims, ...bridges].map((t) => [t.code, t.type])
  );
  const claim_links = Array.from(new Set(parseStringArray(str(formData, 'claim_codes'))))
    .filter((code) => typeByCode.has(code))
    .map((code) => ({ target_type: typeByCode.get(code)!, target_code: code }));

  return {
    slug,
    name,
    short_definition,
    explanation: explanation || null,
    status: status as ConceptStatus,
    prerequisite_ids,
    claim_links,
  };
}

export async function createConceptAction(formData: FormData) {
  await requireAdmin();
  const fields = await readConceptFields(formData);
  try {
    await m.createConcept(fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create the concept.';
    if (/duplicate key|unique/i.test(msg)) throw new Error('A concept with that slug already exists.');
    throw e;
  }
  revalidatePath('/', 'layout');
  redirect(`/concepts/${fields.slug}`);
}

export async function updateConceptAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad concept id.');
  const fields = await readConceptFields(formData, id);
  try {
    await m.updateConcept(id, fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not save the concept.';
    if (/duplicate key|unique/i.test(msg)) throw new Error('A concept with that slug already exists.');
    throw e;
  }
  revalidatePath('/', 'layout');
  redirect(`/concepts/${fields.slug}`);
}

export async function deleteConceptAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad concept id.');
  await m.deleteConcept(id);
  revalidatePath('/', 'layout');
  redirect('/concepts');
}

// Recommend prerequisite concepts (advisory; returns to the client, no DB write —
// the admin confirms each suggestion in the form before anything persists).
export async function recommendConceptPrereqsAction(input: {
  name: string; short_definition: string; explanation: string; excludeId?: string;
}): Promise<ConceptPrereqRecommendation[]> {
  await requireAdmin();
  const name = (input?.name ?? '').trim();
  if (!name) return [];
  const { concepts } = await getConceptGraph();
  const existing = concepts.filter((c) => c.id !== input.excludeId);
  const recs = await recommendConceptPrereqs(
    {
      name,
      short_definition: (input.short_definition ?? '').trim(),
      explanation: (input.explanation ?? '').trim(),
    },
    existing.map((c) => ({ slug: c.slug, name: c.name, short_definition: c.short_definition }))
  );
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  return recs.flatMap((r) => {
    const c = bySlug.get(r.slug);
    return c ? [{ id: c.id, slug: c.slug, name: c.name, reason: r.reason }] : [];
  });
}

// Recommend claim/bridge wiring (advisory; same gate as recommendClaimsAction).
export async function recommendConceptClaimsAction(input: {
  name: string; short_definition: string; explanation: string;
}): Promise<ConceptClaimRecommendation[]> {
  await requireAdmin();
  const name = (input?.name ?? '').trim();
  if (!name) return [];
  const { claims, bridges } = await getTargets();
  return recommendConceptClaims(
    {
      name,
      short_definition: (input.short_definition ?? '').trim(),
      explanation: (input.explanation ?? '').trim(),
    },
    [...claims, ...bridges].map((t) => ({ code: t.code, statement: t.statement, type: t.type }))
  );
}

// ---- Concept gap scan (admin-triggered diagnosis; migration 0018) ----------
// One model call reads the scaffold + the Argument Map and argues for missing
// concepts. Recommend-only: a recommendation can pre-fill /concepts/new, never
// write. The scan persists (singleton) so the review survives a refresh; it is
// reconciled against live concepts on read and on dismiss.

export async function diagnoseConceptGapsAction(): Promise<ConceptGapScan> {
  await requireAdmin();
  const [{ concepts, edges }, { claims, bridges }] = await Promise.all([
    getConceptGraph(), getTargets(),
  ]);
  const slugById = new Map(concepts.map((c) => [c.id, c.slug]));
  const existing = concepts.map((c) => ({
    slug: c.slug,
    name: c.name,
    short_definition: c.short_definition,
    status: c.status,
    prereq_slugs: edges
      .filter((e) => e.concept_id === c.id)
      .map((e) => slugById.get(e.prerequisite_id))
      .filter((s): s is string => !!s),
  }));
  const targets = [...claims, ...bridges].map((t) => ({
    code: t.code, statement: t.statement, type: t.type,
  }));

  const raw = await diagnoseConceptGaps(existing, targets);

  // Re-validate in code (house rule: schema enums are not the gate). A rec must
  // carry a usable slug that doesn't collide with a live concept, and its
  // wiring is filtered to live slugs/codes.
  const liveSlugs = new Set(concepts.map((c) => c.slug));
  const validCodes = new Set(targets.map((t) => t.code));
  const seen = new Set<string>();
  const recommendations: ConceptGapRecommendation[] = [];
  for (const r of raw) {
    const slug = String(r.slug ?? '').toLowerCase().trim();
    const name = String(r.name ?? '').trim().slice(0, 120);
    const short_definition = String(r.short_definition ?? '').trim().slice(0, 500);
    const argument = String(r.argument ?? '').trim().slice(0, 1500);
    if (!CONCEPT_SLUG_RE.test(slug) || slug.length > 64) continue;
    if (liveSlugs.has(slug) || seen.has(slug)) continue;
    if (!name || !short_definition || !argument) continue;
    seen.add(slug);
    recommendations.push({
      slug,
      name,
      short_definition,
      explanation: String(r.explanation ?? '').trim().slice(0, 4000),
      status: (CONCEPT_STATUSES as string[]).includes(r.status) ? (r.status as ConceptStatus) : 'settled',
      prerequisite_slugs: Array.from(new Set(
        (Array.isArray(r.prerequisite_slugs) ? r.prerequisite_slugs : []).filter((s) => liveSlugs.has(s))
      )),
      claim_codes: Array.from(new Set(
        (Array.isArray(r.claim_codes) ? r.claim_codes : []).filter((c) => validCodes.has(c))
      )),
      argument,
    });
    if (recommendations.length >= 5) break;
  }

  const scan: ConceptGapScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveConceptGapScan(scan);   // empty scan clears the singleton
  revalidatePath('/concepts');
  return scan;
}

// Dismiss one recommendation from the persisted scan ("not a gap") so it stays
// gone after a refresh. Mirrors dismissDedupeGroupAction.
export async function dismissConceptGapAction(slug: string): Promise<void> {
  await requireAdmin();
  const s = String(slug ?? '').toLowerCase().trim();
  if (!CONCEPT_SLUG_RE.test(s)) throw new Error('Bad slug.');
  const scan = await getConceptGapScan();
  if (!scan) return;
  const recommendations = scan.recommendations.filter((r) => r.slug !== s);
  await m.saveConceptGapScan(recommendations.length ? { ...scan, recommendations } : null);
  revalidatePath('/concepts');
}

export async function clearConceptGapScanAction(): Promise<void> {
  await requireAdmin();
  await m.saveConceptGapScan(null);
  revalidatePath('/concepts');
}

// ===== Argument-map node authoring (claims + bridges; migration 0021) =========
// Create a new claim or bridge-claim AND its edges, AI-proposed + human-committed.
// Scope is the falsifiable, evidence-bearing nodes; frames/questions/stances are
// out of scope. Every referenced code is re-validated against the live map (house
// rule: never trust the wire); the writer (m.createClaimWithEdges /
// m.createBridgeWithEdges) re-resolves codes to ids inside its transaction.

const GRAPH_RELATIONS: Relation[] = ['supports', 'contradicts', 'depends_on']; // organizes is frame-only
const DOMAIN_VALUES: Domain[] = ['capability', 'economics', 'build_out', 'market', 'labor'];
const RESOLVABILITIES: Resolvability[] = ['clean', 'slow', 'qualitative'];
// Codes follow the seed convention: digits, letters, dots, hyphens (e.g. '3.6', 'B5').
const NODE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,31}$/;

function parseEdgeList(raw: string): { target_type?: string; code: string; relation: string }[] {
  try {
    const v = JSON.parse(raw || '[]');
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is { target_type?: string; code: string; relation: string } =>
        x && typeof x.code === 'string' && typeof x.relation === 'string'
    );
  } catch {
    return [];
  }
}

async function readClaimFields(formData: FormData) {
  const statement = str(formData, 'statement');
  if (!statement || statement.length > 2000) throw new Error('A claim needs a statement (max 2000 characters).');
  const test = str(formData, 'test');
  if (!test || test.length > 2000) throw new Error('A claim needs a falsification test (max 2000 characters).');
  const code = str(formData, 'code');
  if (!NODE_CODE_RE.test(code)) throw new Error('Code must be letters, numbers, dots or hyphens (e.g. 3.6).');
  const domain = str(formData, 'domain');
  if (!(DOMAIN_VALUES as string[]).includes(domain)) throw new Error('Pick a domain for the claim.');
  const resolvabilityRaw = str(formData, 'resolvability');
  const resolvability = (RESOLVABILITIES as string[]).includes(resolvabilityRaw)
    ? (resolvabilityRaw as Resolvability) : null;
  const domain_note = str(formData, 'domain_note').slice(0, 2000) || null;

  // Uniqueness vs the live claim/bridge code namespace (the touch namespace shared by
  // edges/claim_touches/concept_claims). The DB unique constraint is the final backstop.
  const { claims, bridges } = await getTargets();
  const liveCodes = new Set([...claims, ...bridges].map((t) => t.code));
  if (liveCodes.has(code)) throw new Error(`The code "${code}" is already taken.`);

  // Edges: claim -> stance / claim -> bridge_claim. Validate every endpoint against
  // the live lists and dedupe; require at least one stance so the claim has a home.
  const stanceCodes = new Set((await getStanceOptions()).map((s) => s.code));
  const bridgeCodes = new Set(bridges.map((b) => b.code));
  const seen = new Set<string>();
  const edges: { target_type: 'stance' | 'bridge_claim'; target_code: string; relation: Relation }[] = [];
  for (const e of parseEdgeList(str(formData, 'edges'))) {
    const tt = e.target_type === 'stance' || e.target_type === 'bridge_claim' ? e.target_type : null;
    if (!tt) continue;
    if (!(GRAPH_RELATIONS as string[]).includes(e.relation)) continue;
    const ok = tt === 'stance' ? stanceCodes.has(e.code) : bridgeCodes.has(e.code);
    if (!ok) continue;
    const key = `${tt}:${e.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ target_type: tt, target_code: e.code, relation: e.relation as Relation });
  }
  if (!edges.some((e) => e.target_type === 'stance')) {
    throw new Error('A claim must bear on at least one stance, so it has a home on a question map.');
  }

  return { code, statement, test, domain: domain as Domain, domain_note, resolvability, edges };
}

// When the draft was pre-filled from a THESIS gap scan, the form carries the
// thesis id; the human's submit then also maps the new code onto that thesis
// (fill-only; the gap rec self-clears via reconcile once the code is live).
// Non-fatal: the node was created either way.
async function appendCodeToThesis(formData: FormData, code: string): Promise<void> {
  const thesisId = str(formData, 'thesis_id');
  if (!thesisId || !UUID_RE.test(thesisId)) return;
  try {
    await m.appendThesisCode(thesisId, code);
    revalidatePath(`/theses/${thesisId}`);
  } catch {
    // the thesis may have been deleted since the draft opened; the node stands
  }
}

export async function createClaimAction(formData: FormData) {
  await requireAdmin();
  const fields = await readClaimFields(formData);
  let created: { id: string; code: string };
  try {
    created = await m.createClaimWithEdges(fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create the claim.';
    if (/duplicate key|unique/i.test(msg)) throw new Error('A claim or bridge with that code already exists.');
    throw e;
  }
  await appendCodeToThesis(formData, created.code);
  revalidatePath('/', 'layout');
  redirect(`/claim/${encodeURIComponent(created.code)}`);
}

async function readBridgeFields(formData: FormData) {
  const statement = str(formData, 'statement');
  if (!statement || statement.length > 2000) throw new Error('A bridge-claim needs a statement (max 2000 characters).');
  const test = str(formData, 'test');
  if (!test || test.length > 2000) throw new Error('A bridge-claim needs a falsification test (max 2000 characters).');
  const code = str(formData, 'code');
  if (!NODE_CODE_RE.test(code)) throw new Error('Code must be letters, numbers, dots or hyphens (e.g. B5).');
  const domain_from = str(formData, 'domain_from');
  const domain_to = str(formData, 'domain_to');
  if (!(DOMAIN_VALUES as string[]).includes(domain_from) || !(DOMAIN_VALUES as string[]).includes(domain_to)) {
    throw new Error('Pick both the from and to domains.');
  }
  const resolvabilityRaw = str(formData, 'resolvability');
  const resolvability = (RESOLVABILITIES as string[]).includes(resolvabilityRaw)
    ? (resolvabilityRaw as Resolvability) : null;
  const note = str(formData, 'note').slice(0, 2000) || null;

  const { claims, bridges } = await getTargets();
  const liveCodes = new Set([...claims, ...bridges].map((t) => t.code));
  if (liveCodes.has(code)) throw new Error(`The code "${code}" is already taken.`);

  // Feeders: the claims that feed this bridge (claim -> bridge_claim). Optional.
  const claimCodes = new Set(claims.map((c) => c.code));
  const seen = new Set<string>();
  const feeders: { claim_code: string; relation: Relation }[] = [];
  for (const e of parseEdgeList(str(formData, 'feeders'))) {
    if (!(GRAPH_RELATIONS as string[]).includes(e.relation)) continue;
    if (!claimCodes.has(e.code) || seen.has(e.code)) continue;
    seen.add(e.code);
    feeders.push({ claim_code: e.code, relation: e.relation as Relation });
  }

  return {
    code, statement, test,
    domain_from: domain_from as Domain, domain_to: domain_to as Domain,
    resolvability, note, feeders,
  };
}

export async function createBridgeAction(formData: FormData) {
  await requireAdmin();
  const fields = await readBridgeFields(formData);
  let created: { id: string; code: string };
  try {
    created = await m.createBridgeWithEdges(fields);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not create the bridge-claim.';
    if (/duplicate key|unique/i.test(msg)) throw new Error('A claim or bridge with that code already exists.');
    throw e;
  }
  await appendCodeToThesis(formData, created.code);
  revalidatePath('/', 'layout');
  redirect(`/bridge/${encodeURIComponent(created.code)}`);
}

// ---- Argument-map gap diagnosis (admin-triggered; migration 0021) -----------
// One bounded model call reads RECENT EVIDENCE (latest reports + recent signals)
// against the map and argues for missing claims/bridges. Report-grounded and
// restraint-biased: every rec must cite its grounding, and recommending nothing is
// a correct outcome. Recommend-only: a rec pre-fills the authoring form, never
// writes. The scan persists (singleton), reconciled against live codes on read.

export async function diagnoseArgumentGapsAction(): Promise<ArgumentGapScan> {
  await requireAdmin();

  const [{ questions, stances, claims, bridges }, recentReports] = await Promise.all([
    getAllDomainRows(),
    getRecentReports(2),
  ]);
  const slugByQid = new Map(questions.map((qn) => [qn.id, qn.slug]));
  const nonFrameClaims = claims.filter((c) => !c.is_frame);

  // Recent published signals (last ~60 days), recency desc, capped — the granular evidence.
  const sinceISO = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const recentSignals = (await getSignals({ publishedOnly: true, since: sinceISO })).slice(0, 40);

  // No recent evidence to ground on -> recommend nothing (honest), without a model call.
  if (!recentReports.length && !recentSignals.length) {
    await m.saveArgumentGapScan(null);
    revalidatePath('/map');
    return { generatedAt: new Date().toISOString(), recommendations: [] };
  }

  // Label the corpus so the model cites by short label; map labels back to ids/titles.
  const reportByLabel = new Map<string, { id: string; title: string }>();
  const groundingReports = recentReports.map((r, i) => {
    const label = `R${i + 1}`;
    reportByLabel.set(label, { id: r.id, title: r.title });
    const n = r.data?.narrative;
    const text = htmlToText(
      [n?.macroSurvey, ...(n?.perLens ? Object.values(n.perLens) : []), n?.claimsRecap].filter(Boolean).join(' ')
    );
    return { label, title: r.title, text };
  });
  const signalByLabel = new Map<string, string>();
  const groundingSignals = recentSignals.map((s, i) => {
    const label = `S${i + 1}`;
    signalByLabel.set(label, s.id);
    return { label, title: s.title, summary: s.summary ?? '', touches: s.claim_touches ?? [] };
  });

  const mapContext = {
    questions: questions.map((qn) => ({ slug: qn.slug, sort: qn.sort_order, title: qn.title })),
    stances: stances.map((s) => ({ code: s.code, title: s.title, question_slug: slugByQid.get(s.question_id) ?? '' })),
    claims: nonFrameClaims.map((c) => ({ code: c.code, statement: c.statement, test: c.test, domain: c.domain })),
    bridges: bridges.map((b) => ({ code: b.code, statement: b.statement, domain_from: b.domain_from, domain_to: b.domain_to })),
  };

  const raw = await diagnoseArgumentGaps(mapContext, { reports: groundingReports, signals: groundingSignals });

  // Re-validate in code (house rule: schema enums are not the gate; the shared
  // gate in lib/gaps-core.ts is what both scans run through).
  const recommendations = validateGapRecommendations(raw, {
    liveCodes: new Set([...nonFrameClaims, ...bridges].map((t) => t.code)),
    stanceCodes: new Set(stances.map((s) => s.code)),
    bridgeCodes: new Set(bridges.map((b) => b.code)),
    claimCodes: new Set(nonFrameClaims.map((c) => c.code)),
    questionSlugByStance: new Map(stances.map((s) => [s.code, slugByQid.get(s.question_id) ?? ''])),
    liveStatements: [...nonFrameClaims.map((c) => c.statement), ...bridges.map((b) => b.statement)],
    reportByLabel,
    signalByLabel,
  });

  const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations };
  await m.saveArgumentGapScan(scan); // empty scan clears the singleton
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
  const pending = await countPendingPapers(runId);
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
  return countPendingPapers(runId);
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

// ---- The Report Portal's generated reports (tear sheets; migration 0030) ----
// Same decomposition discipline as the thesis console: pack (no AI) -> sections
// (model leg 1) -> close (model leg 2) -> save (re-gated, insert-only). Errors
// return as data so the client stepper can retry a single leg.

const SHEET_CODE_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SHEET_KINDS = ['claim', 'lens', 'atlas'] as const;

function parseSheetScope(scope: { from?: string | null; to?: string | null } | null | undefined): SheetScope {
  const from = scope?.from && ISO_DAY_RE.test(scope.from) ? scope.from : null;
  const to = scope?.to && ISO_DAY_RE.test(scope.to) ? scope.to : null;
  return { from, to };
}

export async function buildSheetPackAction(
  kind: 'claim' | 'lens' | 'atlas',
  subject: string | null,
  scope: { from?: string | null; to?: string | null } | null
): Promise<{ ok: true; pack: SheetPack } | { ok: false; error: string }> {
  await requireAdmin();
  if (!(SHEET_KINDS as readonly string[]).includes(kind)) throw new Error('Bad report kind.');
  if (kind === 'claim' && !(subject && SHEET_CODE_RE.test(subject))) throw new Error('Bad claim code.');
  if (kind === 'lens' && !(subject && (SIGNAL_LENS_SLUGS as readonly string[]).includes(subject))) {
    throw new Error('Bad lens.');
  }
  try {
    const pack = await buildSheetPack(kind, kind === 'atlas' ? null : subject, parseSheetScope(scope));
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pack build error' };
  }
}

export async function generateSheetSectionsAction(
  pack: SheetPack
): Promise<{ ok: true; sections: SheetSectionsOut } | { ok: false; error: string }> {
  await requireAdmin();
  if (!pack || !pack.kind || !pack.stats) return { ok: false, error: 'No pack. Build the evidence pack first.' };
  try {
    const sections = await generateSheetSections(pack);
    return { ok: true, sections };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'section generation error' };
  }
}

export async function generateSheetCloseAction(
  pack: SheetPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string }
): Promise<{ ok: true; bottomLineHtml: string; title: string; dropped: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  if (!pack || !pack.kind || !pack.stats) return { ok: false, error: 'No pack. Build the evidence pack first.' };
  try {
    const out = await generateSheetClose(pack, {
      readingMd: String(sections?.readingMd ?? ''),
      connectionsMd: String(sections?.connectionsMd ?? ''),
      watchMd: String(sections?.watchMd ?? ''),
    });
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'close generation error' };
  }
}

// Freeze a run: re-gate the narrative against the pack at the save boundary (the
// client's HTML is never trusted), insert an immutable generated_reports row.
export async function saveSheetAction(input: {
  title: string;
  pack: SheetPack;
  narrative: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null };
}): Promise<{ id: string }> {
  await requireAdmin();
  const pack = input.pack;
  if (!pack || !pack.kind || !pack.stats) throw new Error('No pack. Build the evidence pack first.');
  if (!['claim', 'bridge', 'lens', 'atlas'].includes(pack.kind)) throw new Error('Bad pack kind.');
  if ((pack.kind === 'claim' || pack.kind === 'bridge') && !(pack.subject && SHEET_CODE_RE.test(pack.subject))) {
    throw new Error('Bad pack subject.');
  }
  if (pack.kind === 'lens' && !(SIGNAL_LENS_SLUGS as readonly string[]).includes(pack.subject)) {
    throw new Error('Bad pack subject.');
  }
  if (JSON.stringify(pack).length > 2_000_000) throw new Error('Pack too large to save.');
  const scope = parseSheetScope(pack.scope);
  const title = (input.title || '').trim().slice(0, 200) || 'Untitled report';
  const narrative: SheetNarrative = gateSheetNarrative(input.narrative, pack);
  const generated_at =
    typeof pack.generated_at === 'string' && !Number.isNaN(Date.parse(pack.generated_at))
      ? pack.generated_at
      : new Date().toISOString();
  const id = await m.saveGeneratedReport({
    kind: pack.kind,
    subject: pack.kind === 'atlas' ? null : pack.subject,
    title,
    scope_from: scope.from,
    scope_to: scope.to,
    pack,
    narrative,
    generated_at,
  });
  revalidatePath('/reports');
  return { id };
}

export async function setSheetPublishedAction(id: string, on: boolean): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.setGeneratedReportPublished(id, !!on);
  revalidatePath('/reports');
  revalidatePath(`/reports/sheet/${id}`);
}

export async function deleteSheetAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad report id.');
  await m.deleteGeneratedReport(id);
  revalidatePath('/reports');
}

// ---- Tickets (the feedback box's admin console) ------------------------------
const TICKET_STATUSES = new Set(['open', 'in_progress', 'resolved', 'declined']);

export async function setTicketStatusAction(id: string, status: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  if (!TICKET_STATUSES.has(status)) throw new Error('Bad status.');
  await m.setTicketStatus(id, status as 'open' | 'in_progress' | 'resolved' | 'declined');
  revalidatePath('/tickets');
}

export async function setTicketNoteAction(id: string, note: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  const trimmed = note.trim().slice(0, 2000);
  await m.setTicketAdminNote(id, trimmed || null);
  revalidatePath('/tickets');
}

export async function deleteTicketAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  await m.deleteTicket(id);
  revalidatePath('/tickets');
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

// ---- Startup Scout (/scout; migration 0034) ---------------------------------
const COMPANY_STATUSES: CompanyStatus[] = ['queued', 'tracked', 'dismissed', 'archived'];
const COMPANY_STAGES: CompanyStage[] = ['pre_seed', 'seed', 'series_a', 'series_b', 'later', 'unknown'];
const COMPANY_EVENT_KINDS: CompanyEventKind[] = ['funding', 'launch', 'news', 'milestone', 'note'];
const VERTICAL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFoundedYear(raw: string): number | null {
  const y = Number(raw);
  if (!Number.isInteger(y)) return null;
  if (y < 1980 || y > 2100) throw new Error('Founded year out of range.');
  return y;
}

// "Add a target": enters the funnel as queued, like any discovery. Open to the
// admin AND portal keyholders (their adds await editorial review). Dedup on
// domain / normalized name routes to the existing profile instead; when a
// portal keyholder hits a dismissed/archived match, redirect to /scout without
// disclosing it.
export async function addTargetAction(formData: FormData) {
  await requirePortal();
  const admin = await isAdmin();
  const name = str(formData, 'name');
  const url = str(formData, 'url');
  const vertical = str(formData, 'vertical');
  const stage = str(formData, 'stage') || 'unknown';
  if (!name) throw new Error('A company name is required.');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  if (!VERTICAL_SLUG_RE.test(vertical)) throw new Error('Bad vertical.');
  if (!(COMPANY_STAGES as string[]).includes(stage)) throw new Error('Bad stage.');
  const { id, existed } = await m.createCompany({
    name,
    url: url || null,
    vertical,
    stage: stage as CompanyStage,
    one_liner: str(formData, 'one_liner') || null,
    ai_tech: str(formData, 'ai_tech') || null,
    founded_year: parseFoundedYear(str(formData, 'founded_year')),
    hq: str(formData, 'hq') || null,
    funding_note: str(formData, 'funding_note') || null,
    origin: 'manual',
  });
  revalidatePath('/scout');
  if (existed && !admin) {
    const visible = await getCompany(id, { admin: false, portal: true });
    if (!visible) redirect('/scout');
  }
  redirect(`/scout/${id}`);
}

// The review decision — the human gate on the acquisition funnel. Tracking a
// company REQUIRES a why (the rationales discipline applied to companies).
export async function reviewCompanyAction(id: string, status: string, note: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad company id.');
  if (!(COMPANY_STATUSES as string[]).includes(status)) throw new Error('Invalid status.');
  const why = String(note ?? '').trim().slice(0, 1000);
  if (status === 'tracked' && !why) throw new Error('Tracking a company requires a why.');
  await m.reviewCompany(id, status as CompanyStatus, why || null);
  revalidatePath('/scout');
}

export async function updateCompanyFactsAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad company id.');
  const stage = str(formData, 'stage') || 'unknown';
  if (!(COMPANY_STAGES as string[]).includes(stage)) throw new Error('Bad stage.');
  await m.updateCompanyFacts(id, {
    one_liner: str(formData, 'one_liner') || null,
    ai_tech: str(formData, 'ai_tech') || null,
    founded_year: parseFoundedYear(str(formData, 'founded_year')),
    stage: stage as CompanyStage,
    funding_note: str(formData, 'funding_note') || null,
    hq: str(formData, 'hq') || null,
  });
  revalidatePath('/scout');
}

export async function addCompanyEventAction(formData: FormData) {
  await requireAdmin();
  const companyId = str(formData, 'company_id');
  const eventDate = str(formData, 'event_date');
  const kind = str(formData, 'kind');
  const title = str(formData, 'title');
  const url = str(formData, 'url');
  if (!UUID_RE.test(companyId)) throw new Error('Bad company id.');
  if (!DATE_RE.test(eventDate)) throw new Error('Bad event date.');
  if (!(COMPANY_EVENT_KINDS as string[]).includes(kind)) throw new Error('Bad event kind.');
  if (!title) throw new Error('An event title is required.');
  if (url && !/^https?:\/\//i.test(url)) throw new Error('The URL must be http(s).');
  await m.createCompanyEvent({
    company_id: companyId,
    event_date: eventDate,
    kind: kind as CompanyEventKind,
    title,
    url: url || null,
    note: str(formData, 'note') || null,
  });
  revalidatePath('/scout');
}

export async function deleteCompanyEventAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad event id.');
  await m.deleteCompanyEvent(id);
  revalidatePath('/scout');
}

export async function addVerticalAction(formData: FormData) {
  await requireAdmin();
  const slug = str(formData, 'slug');
  const name = str(formData, 'name');
  if (!VERTICAL_SLUG_RE.test(slug)) throw new Error('Slug must be kebab-case (a-z, 0-9, dashes).');
  if (!name) throw new Error('A vertical name is required.');
  const queries = str(formData, 'search_queries')
    .split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  await m.upsertVertical({
    slug, name,
    description: str(formData, 'description') || null,
    search_queries: queries,
  });
  revalidatePath('/scout');
}

export async function setVerticalActiveAction(slug: string, active: boolean): Promise<void> {
  await requireAdmin();
  if (!VERTICAL_SLUG_RE.test(slug)) throw new Error('Bad vertical.');
  await m.setVerticalActive(slug, Boolean(active));
  revalidatePath('/scout');
}

// ---- Scout discovery (phase 2): console-driven, DB-checkpointed batches -----
export async function startScoutRunAction(): Promise<{ runId: string; plan: ScoutBatchRef[] }> {
  await requireAdmin();
  const verticals = await getScoutVerticals();
  const plan = scoutPlan(verticals);
  if (!plan.length) throw new Error('No active vertical carries discovery queries.');
  const runId = await m.createScoutRun();
  return { runId, plan };
}

export async function discoverScoutBatchAction(
  runId: string, vertical: string, batchIndex: number
): Promise<{ found: number; inserted: number }> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  if (!VERTICAL_SLUG_RE.test(vertical)) throw new Error('Bad vertical.');
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex > 30) throw new Error('Bad batch index.');
  return discoverScoutBatch(runId, vertical, batchIndex);
}

export async function completeScoutRunAction(runId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) throw new Error('Bad run id.');
  await m.completeScoutRun(runId);
  revalidatePath('/scout');
}

export async function failScoutRunAction(runId: string, message: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(runId)) return;
  await m.failScoutRun(runId, String(message ?? 'failed').slice(0, 500));
  revalidatePath('/scout');
}

// ---- Scout scoring agent (phase 3; recommend-only, human commits) -----------
export async function scoreScoutChunkAction(ids: string[]): Promise<{
  ok: boolean; processed?: number; pursue?: number; watch?: number; pass?: number; error?: string;
}> {
  await requireAdmin();
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every((i) => UUID_RE.test(i))) {
    return { ok: false, error: 'Bad chunk.' };
  }
  try {
    const r = await scoreScoutChunk(ids);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Agent call failed.' };
  }
}

export async function saveScoutPrefsAction(steering: string, rubric: string): Promise<void> {
  await requireAdmin();
  await m.saveScoutPrefs(
    String(steering ?? '').trim().slice(0, 1500) || null,
    String(rubric ?? '').trim().slice(0, 4000) || null
  );
  revalidatePath('/scout');
}

export async function acceptScoutRecommendationsAction(verdict: string): Promise<{ ids: string[] }> {
  await requireAdmin();
  if (!['pursue', 'pass'].includes(verdict)) throw new Error('Bad verdict.');
  const ids = await m.acceptScoutRecommendations(verdict as 'pursue' | 'pass');
  revalidatePath('/scout');
  return { ids };
}

// ---- Scout research tools (admin + portal, budget-metered) ------------------
// THE GATE TEMPLATE for every portal-permitted scout action:
//   1. requirePortal() (admits admins); compute admin for the feature slug.
//   2. Validate inputs; steering is a one-off instruction, never persisted.
//   3. Portal viewers may only touch companies they can SEE (tracked/queued);
//      the failure is the SAME generic error as an unknown id, so a keyholder
//      cannot probe for dismissed targets.
//   4. Portal calls pass the daily budget check first.
//   5. Feature slug: admin work logs per-tool; portal work logs 'portal_scout'
//      (summed by checkPortalBudget), tool kept in metadata.

const GENERIC_TARGET_ERROR = 'Unknown company.';

async function gateScoutTarget(id: string, admin: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: GENERIC_TARGET_ERROR };
  if (!admin) {
    const visible = await getCompany(id, { admin: false, portal: true });
    if (!visible) return { ok: false, error: GENERIC_TARGET_ERROR };
    const budget = await checkPortalBudget();
    if (!budget.ok) {
      return { ok: false, error: 'The team daily AI budget is spent. It resets at midnight UTC.' };
    }
  }
  return { ok: true };
}

export async function intelSweepAction(id: string, steering: string): Promise<{
  ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string;
}> {
  await requirePortal();
  const admin = await isAdmin();
  const gate = await gateScoutTarget(id, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await runIntelSweep(id, steer, admin ? 'scout_intel' : 'portal_scout');
    revalidatePath('/scout');
    return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The sweep failed.' };
  }
}

// Document extraction: the text was extracted in the BROWSER (the ingest
// form's unpdf pattern); only sanitized text reaches the server, capped well
// under the server-action body limit. The document is retained for re-reads.
export async function extractCompanyDocAction(
  companyId: string, filename: string, text: string, steering: string
): Promise<{ ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string }> {
  await requirePortal();
  const admin = await isAdmin();
  const gate = await gateScoutTarget(companyId, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const body = String(text ?? '');
  if (body.length < 200) return { ok: false, error: 'The document text is too short to read.' };
  if (body.length > 200_000) return { ok: false, error: 'The document text exceeds the 200k character cap.' };
  const name = String(filename ?? '').trim().slice(0, 200) || 'document.pdf';
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const docId = await m.createCompanyDocument({
      company_id: companyId, filename: name, origin: admin ? 'admin' : 'portal', text: body,
    });
    try {
      const r = await extractFromDocument(companyId, docId, steer, admin ? 'scout_doc' : 'portal_scout');
      revalidatePath('/scout');
      return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
    } catch (e) {
      // The document IS retained at this point; the model leg can stall (TTFT).
      revalidatePath('/scout');
      return {
        ok: false,
        error: `${e instanceof Error ? e.message : 'The read failed.'} The document was saved: use Re-extract to retry.`,
      };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The extraction failed.' };
  }
}

export async function reExtractDocAction(docId: string, steering: string): Promise<{
  ok: boolean; filled?: string[]; events?: number; skipped?: number; error?: string;
}> {
  await requirePortal();
  const admin = await isAdmin();
  if (!UUID_RE.test(docId)) return { ok: false, error: GENERIC_TARGET_ERROR };
  const doc = await getCompanyDocumentText(docId);
  if (!doc) return { ok: false, error: GENERIC_TARGET_ERROR };
  const gate = await gateScoutTarget(doc.company_id, admin);
  if (!gate.ok) return { ok: false, error: gate.error };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await extractFromDocument(doc.company_id, docId, steer, admin ? 'scout_doc' : 'portal_scout');
    revalidatePath('/scout');
    return { ok: true, filled: r.filled, events: r.eventsAdded, skipped: r.eventsSkipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The extraction failed.' };
  }
}

export async function deleteCompanyDocAction(docId: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(docId)) throw new Error('Bad document id.');
  await m.deleteCompanyDocument(docId);
  revalidatePath('/scout');
}

// Competitor scan: ADMIN-ONLY. It mass-creates queue rows (the admin's review
// desk), so the portal tier gets no button and no gate through here.
export async function competitorScanAction(id: string, steering: string): Promise<{
  ok: boolean; found?: number; inserted?: number; names?: string[]; error?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { ok: false, error: GENERIC_TARGET_ERROR };
  const steer = String(steering ?? '').trim().slice(0, 1000) || null;
  try {
    const r = await scanCompetitors(id, steer);
    revalidatePath('/scout');
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The scan failed.' };
  }
}

// ---- Scout enrichment (phase 4) ---------------------------------------------
export async function enrichCompanyAction(id: string): Promise<{
  ok: boolean; via?: string; filled?: string[]; error?: string;
}> {
  await requireAdmin();
  if (!UUID_RE.test(id)) return { ok: false, error: 'Bad company id.' };
  try {
    const r = await enrichCompany(id);
    revalidatePath('/scout');
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Enrichment failed.' };
  }
}

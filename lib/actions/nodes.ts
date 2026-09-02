'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import {
  getTargets, getStanceOptions,
  getAllDomainRows, getRecentReports, getSignals, getArgumentGapScan } from '../data';
import { diagnoseArgumentGaps, htmlToText } from '../argument-gaps';
import { validateGapRecommendations } from '../gaps-core';
import type {
  Domain, Resolvability, Relation,
  ArgumentGapScan,
  } from '../types';
import { UUID_RE, isUniqueViolation, requireAdmin, str } from './shared';

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
    if (isUniqueViolation(e)) throw new Error('A claim or bridge with that code already exists.');
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
    if (isUniqueViolation(e)) throw new Error('A claim or bridge with that code already exists.');
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

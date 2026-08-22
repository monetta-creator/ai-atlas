'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import {
  getTargets, getConceptGraph, getConceptGapScan } from '../data';
import { recommendConceptPrereqs, recommendConceptHypotheses, diagnoseConceptGaps } from '../concepts';
import type {
  ConceptStatus, ConceptPrereqRecommendation, ConceptHypothesisRecommendation,
  ConceptGapScan, ConceptGapRecommendation,
  } from '../types';
import { UUID_RE, requireAdmin, str } from './shared';
import { parseStringArray } from './shared';

// ===== Concepts (the semantic scaffold) =====================================

const CONCEPT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONCEPT_STATUSES: ConceptStatus[] = ['settled', 'contested'];

// Read + validate the shared concept fields from the create/edit form. The client
// only ever sends prerequisite IDS and hypothesis CODES — both are re-checked
// against the live lists here (never trusted from the wire).
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

  const { hypotheses } = await getTargets();
  const validCodes = new Set(hypotheses.map((t) => t.code));
  const codes = Array.from(new Set(parseStringArray(str(formData, 'codes'))))
    .filter((code) => validCodes.has(code));

  return {
    slug,
    name,
    short_definition,
    explanation: explanation || null,
    status: status as ConceptStatus,
    prerequisite_ids,
    codes,
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

// Recommend hypothesis wiring (advisory; same gate as recommendHypothesesAction).
export async function recommendConceptHypothesesAction(input: {
  name: string; short_definition: string; explanation: string;
}): Promise<ConceptHypothesisRecommendation[]> {
  await requireAdmin();
  const name = (input?.name ?? '').trim();
  if (!name) return [];
  const { hypotheses } = await getTargets();
  return recommendConceptHypotheses(
    {
      name,
      short_definition: (input.short_definition ?? '').trim(),
      explanation: (input.explanation ?? '').trim(),
    },
    hypotheses.map((t) => ({ code: t.code, statement: t.statement }))
  );
}

// ---- Concept gap scan (admin-triggered diagnosis) --------------------------
// One model call reads the scaffold + the tracked hypotheses and argues for
// missing concepts. Recommend-only: a recommendation can pre-fill /concepts/new,
// never write. The scan persists (singleton) so the review survives a refresh;
// it is reconciled against live concepts on read and on dismiss.

export async function diagnoseConceptGapsAction(): Promise<ConceptGapScan> {
  await requireAdmin();
  const [{ concepts, edges }, { hypotheses }] = await Promise.all([
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
  const targets = hypotheses.map((t) => ({ code: t.code, statement: t.statement }));

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
      hypothesis_codes: Array.from(new Set(
        (Array.isArray(r.hypothesis_codes) ? r.hypothesis_codes : []).filter((c) => validCodes.has(c))
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

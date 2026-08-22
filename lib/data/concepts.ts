import { q, one } from '../db';
import type {
  ConvictionLabel,
  Concept, ConceptEdge, ConceptGraphData, ConceptRef, ConceptHypothesisLink, ConceptDetail,
  ConceptGapScan, ArgumentGapScan,
  } from '../types';

// ---------------------------------------------------------------- concepts (the semantic scaffold)
// Public reads. Concepts carry no personal layer of their own — only the
// hypothesis links resolve into conviction words, which are stripped for guests
// like everywhere else. Both link tables are filtered to status='confirmed' so a
// future 'suggested' queue could never leak into the public graph.

export async function getConceptGraph(): Promise<ConceptGraphData> {
  const [concepts, edges] = await Promise.all([
    q<Concept>(`select * from concepts order by name`),
    q<ConceptEdge>(
      `select concept_id, prerequisite_id from concept_edges where status = 'confirmed'`
    ),
  ]);
  return { concepts, edges };
}

export async function getConcept(slug: string, personal: boolean): Promise<ConceptDetail | null> {
  const concept = await one<Concept>(`select * from concepts where slug = $1`, [slug]);
  if (!concept) return null;

  const [prerequisites, dependents, links] = await Promise.all([
    q<ConceptRef>(
      `select c.id, c.slug, c.name, c.short_definition, c.status
         from concept_edges e join concepts c on c.id = e.prerequisite_id
        where e.concept_id = $1 and e.status = 'confirmed'
        order by c.name`,
      [concept.id]
    ),
    q<ConceptRef>(
      `select c.id, c.slug, c.name, c.short_definition, c.status
         from concept_edges e join concepts c on c.id = e.concept_id
        where e.prerequisite_id = $1 and e.status = 'confirmed'
        order by c.name`,
      [concept.id]
    ),
    q<{ code: string }>(
      `select code from concept_links
        where concept_id = $1 and status = 'confirmed'
        order by code`,
      [concept.id]
    ),
  ]);

  // Resolve the stored codes against the live atlas (mirrors resolveTouches): an
  // admin sees a dangling code flagged; a guest never sees a broken link.
  const codes = links.map((l) => l.code);
  const rows = codes.length
    ? await q<{ code: string; statement: string; conviction_label: ConvictionLabel }>(
        `select code, statement, conviction_label from hypotheses where code = any($1)`,
        [codes]
      )
    : [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const hypotheses = links
    .map((l): ConceptHypothesisLink | null => {
      const r = byCode.get(l.code);
      if (!r) {
        return personal
          ? {
              code: l.code,
              statement: 'This code no longer resolves to a hypothesis.',
              conviction_label: null, href: '#', unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        statement: r.statement,
        conviction_label: personal ? r.conviction_label : null,
        href: `/hypothesis/${encodeURIComponent(r.code)}`,
      };
    })
    .filter((x): x is ConceptHypothesisLink => x !== null);

  return { concept, prerequisites, dependents, hypotheses };
}

// Edit-form read: the raw row plus its prerequisite ids and hypothesis codes
// (admin-only caller; no status filter so nothing the form writes is invisible).
export async function getConceptForEdit(slug: string): Promise<{
  concept: Concept;
  prerequisite_ids: string[];
  codes: string[];
} | null> {
  const concept = await one<Concept>(`select * from concepts where slug = $1`, [slug]);
  if (!concept) return null;
  const [prereqs, links] = await Promise.all([
    q<{ prerequisite_id: string }>(
      `select prerequisite_id from concept_edges where concept_id = $1`,
      [concept.id]
    ),
    q<{ code: string }>(
      `select code from concept_links where concept_id = $1 order by code`,
      [concept.id]
    ),
  ]);
  return {
    concept,
    prerequisite_ids: prereqs.map((r) => r.prerequisite_id),
    codes: links.map((r) => r.code),
  };
}

// The persisted concept gap scan (singleton), or null if none.
export async function getConceptGapScan(): Promise<ConceptGapScan | null> {
  const row = await one<{ recommendation: ConceptGapScan }>(
    `select recommendation from concept_gap_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop recommendations whose slug now names a live concept (created since the scan),
// so a persisted scan never re-recommends something that exists. Pure (no DB),
// mirroring reconcileDedupeScan.
export function reconcileConceptGapScan(
  scan: ConceptGapScan | null, liveSlugs: Set<string>
): ConceptGapScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveSlugs.has(r.slug));
  return recommendations.length ? { ...scan, recommendations } : null;
}

// The persisted argument-map gap scan (singleton), or null if none.
export async function getArgumentGapScan(): Promise<ArgumentGapScan | null> {
  const row = await one<{ recommendation: ArgumentGapScan }>(
    `select recommendation from argument_gap_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop recommendations whose proposed code now names a live hypothesis (created
// since the scan), so a persisted scan never re-recommends something that exists.
// Pure (no DB), mirroring reconcileConceptGapScan.
export function reconcileArgumentGapScan(
  scan: ArgumentGapScan | null, liveCodes: Set<string>
): ArgumentGapScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveCodes.has(r.code));
  return recommendations.length ? { ...scan, recommendations } : null;
}

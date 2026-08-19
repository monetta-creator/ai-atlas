import { q, one } from '../db';
import type {
  ConfidenceLabel,
  Concept, ConceptEdge, ConceptGraphData, ConceptRef, ConceptClaimLink, ConceptDetail,
  ConceptGapScan, ArgumentGapScan,
  } from '../types';

// ---------------------------------------------------------------- concepts (the semantic scaffold)
// Public reads. Concepts carry no personal layer of their own — only the claim
// links resolve into confidence words, which are stripped for guests like
// everywhere else. Both link tables are filtered to status='confirmed' so a
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
    q<{ target_type: 'claim' | 'bridge_claim'; target_code: string }>(
      `select target_type, target_code from concept_claims
        where concept_id = $1 and status = 'confirmed'
        order by target_code`,
      [concept.id]
    ),
  ]);

  // Resolve the stored codes against the live map (mirrors resolveTouches): an
  // admin sees a dangling code flagged; a guest never sees a broken link.
  const codes = links.map((l) => l.target_code);
  const rows = codes.length
    ? await q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; confidence_label: ConfidenceLabel }>(
        `select code, 'claim'::text as type, statement, confidence_label
           from claims where code = any($1)
         union all
         select code, 'bridge_claim'::text as type, statement, confidence_label
           from bridge_claims where code = any($1)`,
        [codes]
      )
    : [];
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.code}`, r]));
  const claims = links
    .map((l): ConceptClaimLink | null => {
      const r = byKey.get(`${l.target_type}:${l.target_code}`);
      if (!r) {
        return personal
          ? {
              code: l.target_code, type: l.target_type,
              statement: 'This code no longer resolves to a claim or bridge-claim.',
              confidence_label: null, href: '#', unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        type: r.type,
        statement: r.statement,
        confidence_label: personal ? r.confidence_label : null,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
      };
    })
    .filter((x): x is ConceptClaimLink => x !== null);

  return { concept, prerequisites, dependents, claims };
}

// Edit-form read: the raw row plus its prerequisite ids and claim codes (admin-only
// caller; no status filter so nothing the form writes can be invisible to it).
export async function getConceptForEdit(slug: string): Promise<{
  concept: Concept;
  prerequisite_ids: string[];
  claim_codes: string[];
} | null> {
  const concept = await one<Concept>(`select * from concepts where slug = $1`, [slug]);
  if (!concept) return null;
  const [prereqs, links] = await Promise.all([
    q<{ prerequisite_id: string }>(
      `select prerequisite_id from concept_edges where concept_id = $1`,
      [concept.id]
    ),
    q<{ target_code: string }>(
      `select target_code from concept_claims where concept_id = $1 order by target_code`,
      [concept.id]
    ),
  ]);
  return {
    concept,
    prerequisite_ids: prereqs.map((r) => r.prerequisite_id),
    claim_codes: links.map((r) => r.target_code),
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

// ---- Argument-map node authoring (claims + bridges; migration 0021) ----------

// Every stance the author can wire a new claim to, with its owning question's slug
// (for routing a claim draft to /q/<slug>/claim/new) and sort order (for code
// suggestion). The non-frame claim picker reuses getTargets(); bridges too.
interface StanceOption {
  id: string;
  code: string;
  title: string;
  question_slug: string;
  question_sort: number;
}

export async function getStanceOptions(): Promise<StanceOption[]> {
  return q<StanceOption>(
    `select s.id, s.code, s.title, qn.slug as question_slug, qn.sort_order as question_sort
       from stances s join questions qn on qn.id = s.question_id
      order by qn.sort_order, s.sort_order`
  );
}

// Suggest the next free claim code in the seed convention "<questionSort>.<n>"
// (e.g. question 3 -> '3.6'). The unique constraint is the backstop; this is only a
// convenience default the admin can overwrite.
export function nextClaimCode(questionSort: number, existingCodes: string[]): string {
  const prefix = `${questionSort}.`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const minor = Number(code.slice(prefix.length));
    if (Number.isInteger(minor) && minor > max) max = minor;
  }
  return `${prefix}${max + 1}`;
}

// Suggest the next free bridge code in the seed convention "B<n>" (e.g. 'B5').
export function nextBridgeCode(existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    const mt = /^B(\d+)$/.exec(code);
    if (mt) {
      const n = Number(mt[1]);
      if (n > max) max = n;
    }
  }
  return `B${max + 1}`;
}

// The persisted argument-map gap scan (singleton), or null if none.
export async function getArgumentGapScan(): Promise<ArgumentGapScan | null> {
  const row = await one<{ recommendation: ArgumentGapScan }>(
    `select recommendation from argument_gap_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop recommendations whose proposed code now names a live claim/bridge (created
// since the scan), so a persisted scan never re-recommends something that exists.
// Pure (no DB), mirroring reconcileConceptGapScan.
export function reconcileArgumentGapScan(
  scan: ArgumentGapScan | null, liveCodes: Set<string>
): ArgumentGapScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveCodes.has(r.code));
  return recommendations.length ? { ...scan, recommendations } : null;
}

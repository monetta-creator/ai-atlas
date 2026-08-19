import type {
  ArgumentGapEdge, ArgumentGapRecommendation, Domain, Relation, Resolvability,
} from './types';

// The shared post-validation gate for gap diagnoses (the map-wide scan and the
// per-thesis scan). House rule: schema enums are not the gate; every model output
// is re-validated here in code before it persists. DELIBERATELY dependency-light
// (type-only imports) so scripts/test-gaps.mjs can load it with Node's type
// stripping and drive the exact production gates.

// The untrusted model shape, straight out of the forced-tool call.
export interface RawGapRec {
  kind: string;
  code: string;
  statement: string;
  test: string;
  domain: string;
  domain_from: string;
  domain_to: string;
  resolvability: string;
  suggested_edges: { code: string; relation: string }[];
  argument: string;
  grounding: { report_label?: string; signal_labels: string[]; finding: string };
}

export const GAP_RELATIONS = ['supports', 'contradicts', 'depends_on']; // organizes is frame-only
export const GAP_DOMAINS = ['capability', 'economics', 'build_out', 'market', 'labor'];
export const GAP_RESOLVABILITIES = ['clean', 'slow', 'qualitative'];
export const GAP_NODE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-]{0,31}$/;

// Novelty normalization: paraphrase-duplicates of an existing statement are rejected.
export function normStatement(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export interface GapValidationCtx {
  liveCodes: Set<string>;                 // claim + bridge codes (collision bar)
  stanceCodes: Set<string>;
  bridgeCodes: Set<string>;
  claimCodes: Set<string>;                // non-frame claims
  questionSlugByStance: Map<string, string>;
  liveStatements: string[];               // raw statements; normalized here
  reportByLabel?: Map<string, { id: string; title: string }>;
  signalByLabel: Map<string, string>;     // label -> signal id
  // When true (the map-wide scan), a rec must cite at least one report/signal.
  // The thesis scan sets false: its grounding can be the thesis's own uncovered
  // leg, named in `finding` (signal citations strengthen but are not required).
  requireRef?: boolean;
  max?: number;                           // recommendation cap (default 3)
}

export function validateGapRecommendations(
  raw: RawGapRec[], ctx: GapValidationCtx
): ArgumentGapRecommendation[] {
  const requireRef = ctx.requireRef ?? true;
  const max = ctx.max ?? 3;
  const rels = new Set(GAP_RELATIONS);
  const liveStatements = new Set(ctx.liveStatements.map(normStatement));
  const reportByLabel = ctx.reportByLabel ?? new Map<string, { id: string; title: string }>();

  const seenCodes = new Set<string>();
  const recommendations: ArgumentGapRecommendation[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const kind = r.kind === 'claim' || r.kind === 'bridge' ? r.kind : null;
    if (!kind) continue;
    const code = String(r.code ?? '').trim();
    const statement = String(r.statement ?? '').trim().slice(0, 2000);
    const test = String(r.test ?? '').trim().slice(0, 2000);
    const argument = String(r.argument ?? '').trim().slice(0, 1500);
    const finding = String(r.grounding?.finding ?? '').trim().slice(0, 600);
    if (!GAP_NODE_CODE_RE.test(code) || ctx.liveCodes.has(code) || seenCodes.has(code)) continue;
    if (!statement || !test || !argument) continue;
    if (liveStatements.has(normStatement(statement))) continue; // novelty bar

    // Grounding bar: a finding always; a resolvable report/signal citation when required.
    const reportRef = r.grounding?.report_label ? reportByLabel.get(r.grounding.report_label) : undefined;
    const signalIds = Array.from(new Set(
      (Array.isArray(r.grounding?.signal_labels) ? r.grounding.signal_labels : [])
        .map((l) => ctx.signalByLabel.get(l))
        .filter((id): id is string => !!id)
    ));
    if (!finding) continue;
    if (requireRef && !reportRef && !signalIds.length) continue;

    // Edges: per-kind. claim -> stance/bridge (>=1 stance required); bridge -> feeding claims.
    const seenEdge = new Set<string>();
    const edges: ArgumentGapEdge[] = [];
    for (const e of Array.isArray(r.suggested_edges) ? r.suggested_edges : []) {
      const ec = String(e?.code ?? '');
      const rel = String(e?.relation ?? '');
      if (!rels.has(rel) || seenEdge.has(ec)) continue;
      const ok = kind === 'claim'
        ? ctx.stanceCodes.has(ec) || ctx.bridgeCodes.has(ec)
        : ctx.claimCodes.has(ec);
      if (!ok) continue;
      seenEdge.add(ec);
      edges.push({ code: ec, relation: rel as Relation });
    }

    let domain: Domain | null = null;
    let domain_from: Domain | null = null;
    let domain_to: Domain | null = null;
    let question_slug: string | null = null;
    if (kind === 'claim') {
      if (!GAP_DOMAINS.includes(r.domain)) continue;
      domain = r.domain as Domain;
      const home = edges.find((e) => ctx.stanceCodes.has(e.code));
      if (!home) continue; // a claim needs a stance home
      question_slug = ctx.questionSlugByStance.get(home.code) ?? null;
      if (!question_slug) continue;
    } else {
      if (!GAP_DOMAINS.includes(r.domain_from) || !GAP_DOMAINS.includes(r.domain_to)) continue;
      domain_from = r.domain_from as Domain;
      domain_to = r.domain_to as Domain;
    }
    const resolvability = GAP_RESOLVABILITIES.includes(r.resolvability)
      ? (r.resolvability as Resolvability) : null;

    seenCodes.add(code);
    recommendations.push({
      kind, code, statement, test, domain, domain_from, domain_to, resolvability,
      question_slug, edges, argument,
      grounding: {
        report_id: reportRef?.id ?? null,
        report_title: reportRef?.title ?? null,
        signal_ids: signalIds,
        finding,
      },
    });
    if (recommendations.length >= max) break;
  }
  return recommendations;
}

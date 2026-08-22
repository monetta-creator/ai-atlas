import type {
  ArgumentGapRecommendation, Resolvability,
} from './types';

// The shared post-validation gate for gap diagnoses (the atlas-wide scan and the
// per-hypothesis scan). House rule: schema enums are not the gate; every model
// output is re-validated here in code before it persists. DELIBERATELY
// dependency-light (type-only imports) so a plain-Node test can load it with
// type stripping and drive the exact production gates.

// The untrusted model shape, straight out of the forced-tool call.
export interface RawGapRec {
  code: string;
  statement: string;
  test: string;
  resolvability: string;
  argument: string;
  grounding: { report_label?: string; signal_labels: string[]; finding: string };
}

const GAP_RESOLVABILITIES = ['clean', 'slow', 'qualitative'];
export const GAP_NODE_CODE_RE = /^H[0-9]{1,4}$/;

// Novelty normalization: paraphrase-duplicates of an existing statement are rejected.
export function normStatement(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

interface GapValidationCtx {
  liveCodes: Set<string>;                 // existing hypothesis codes (collision bar)
  liveStatements: string[];               // raw statements; normalized here
  reportByLabel?: Map<string, { id: string; title: string }>;
  signalByLabel: Map<string, string>;     // label -> signal id
  // When true (the atlas-wide scan), a rec must cite at least one report/signal.
  // The per-hypothesis scan sets false: its grounding can be the hypothesis's own
  // uncovered leg, named in `finding` (signal citations strengthen, not required).
  requireRef?: boolean;
  max?: number;                           // recommendation cap (default 3)
}

export function validateGapRecommendations(
  raw: RawGapRec[], ctx: GapValidationCtx
): ArgumentGapRecommendation[] {
  const requireRef = ctx.requireRef ?? true;
  const max = ctx.max ?? 3;
  const liveStatements = new Set(ctx.liveStatements.map(normStatement));
  const reportByLabel = ctx.reportByLabel ?? new Map<string, { id: string; title: string }>();

  const seenCodes = new Set<string>();
  const recommendations: ArgumentGapRecommendation[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
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

    const resolvability = GAP_RESOLVABILITIES.includes(r.resolvability)
      ? (r.resolvability as Resolvability) : null;

    seenCodes.add(code);
    recommendations.push({
      code, statement, test, resolvability, argument,
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

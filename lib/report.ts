import { getSignals, resolvePeriodTouches } from './data';
import { SIGNAL_CONTEXT_SLUGS } from './format';
import type { Report, SignalContext } from './types';

// Report DATA assembly. This module is RSC-safe (no react-dom/server) so the report page
// can import buildReportData directly. The AI narrative generation lives in
// lib/report-generate.ts (imports `marked`, kept out of the RSC graph and imported only
// by the 'use server' actions). Low-level period reads live in lib/data/reports.ts.

// Assemble the DATA half of a Report (narrative left null). Phase-2 generation reads
// `byContext` + `touches` and fills `narrative`. `personal` strips conviction_label
// on touches for guests (the generator is admin-only, but the personal-layer firewall
// stays honest end-to-end).
export async function buildReportData(opts: {
  from: string;
  to: string;
  contexts: SignalContext[];
  personal: boolean;
}): Promise<Report> {
  const { from, to, contexts, personal } = opts;
  const selected = SIGNAL_CONTEXT_SLUGS.filter((c) => contexts.includes(c));

  // 1) In-range published signals for the selected contexts (reuses getSignals + `until`).
  const signals = await getSignals({
    publishedOnly: true,
    since: from,
    until: to,
    contexts: selected.length ? selected : undefined,
  });

  // 2) Distinct touched codes + per-code cohort count, built in JS from the signals above
  //    (no second signals read), then resolved to hypothesis statements.
  const counts = new Map<string, number>();
  for (const s of signals) {
    for (const code of s.touches) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const touches = await resolvePeriodTouches(counts, personal);

  // 3) By-context signal grouping (Phase-2 per-context generation input) — derived in JS
  //    from `signals`, so the cohort is identical to report.signals.
  const byContext = selected.map((c) => ({
    context: c,
    signals: signals.filter((s) => s.context === c),
  }));

  return {
    range: { from, to },
    contexts: selected,
    generatedAt: new Date().toISOString(),
    signals,
    touches,
    byContext,
    narrative: { macroSurvey: null, perContext: {}, claimsRecap: null, callouts: {} },
  };
}

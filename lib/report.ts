import { getSignals, getReportFunnel, resolvePeriodTouches } from './data';
import type { ReportFunnelRow } from './data';
import { SIGNAL_LENS_SLUGS } from './format';
import type { Report, ReportFunnel, ReportMetrics, SignalLens } from './types';

// Report DATA assembly. This module is RSC-safe (no react-dom/server) so the /report page
// can import buildReportData directly. The AI narrative generation lives in
// lib/report-generate.ts (imports react-dom/server, so it's kept out of the RSC graph and
// imported only by the 'use server' actions). Low-level period reads live in lib/data.ts.

// A zeroed funnel row for a lens (or overall) that had no candidates in the period, so
// every selected lens gets a row and the rate math has a stable shape.
function zeroRow(lens: SignalLens | null): ReportFunnelRow {
  return {
    lens, candidates: 0, approved: 0, rejected: 0,
    duplicate: 0, drafted: 0, discarded: 0, published: 0,
  };
}

// Derive the four headline rates from integer counts. Division-guarded: a 0 denominator
// yields null (never NaN), which the UI renders as "—".
function ratesFrom(c: ReportFunnelRow): ReportFunnel {
  const rate = (num: number, den: number) => (den > 0 ? num / den : null);
  return {
    counts: {
      candidates: c.candidates, approved: c.approved, rejected: c.rejected,
      duplicate: c.duplicate, drafted: c.drafted, discarded: c.discarded, published: c.published,
    },
    rates: {
      triagePass: rate(c.approved, c.approved + c.rejected),
      analysisConversion: rate(c.drafted, c.approved),
      discoveryToSignal: rate(c.drafted, c.candidates),
      draftToPublished: rate(c.published, c.drafted),
    },
  };
}

// Assemble the DATA half of a Report (narrative left null). Phase-2 generation reads
// `byLens` + `metrics` + `touches` and fills `narrative`. `personal` strips
// confidence_label on touches for guests (the report is admin-only in Phase 1, but the
// personal-layer firewall stays honest end-to-end).
export async function buildReportData(opts: {
  from: string;
  to: string;
  lenses: SignalLens[];
  personal: boolean;
}): Promise<Report> {
  const { from, to, lenses, personal } = opts;
  const selected = SIGNAL_LENS_SLUGS.filter((l) => lenses.includes(l));

  // 1) In-range published signals for the selected lenses (reuses getSignals + new `until`).
  const signals = await getSignals({
    publishedOnly: true,
    since: from,
    until: to,
    lenses: selected.length ? selected : undefined,
  });

  // 2) Distinct touched codes + per-code cohort count, built in JS from the signals above
  //    (no second signals read), then resolved to claim/bridge statements.
  const counts = new Map<string, number>();
  for (const s of signals) {
    for (const code of s.claim_touches) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const touches = await resolvePeriodTouches(counts, personal);

  // 3) Period pipeline funnel — overall + per-lens from one GROUPING SETS query. The
  //    null-lens row is the true grand total across ALL lenses (kept as `overall` so the
  //    funnel reads honestly regardless of the lens selection); per-lens is filtered to
  //    the selected set.
  const rows = await getReportFunnel(from, to);
  const overallRow = rows.find((r) => r.lens === null) ?? zeroRow(null);
  const metrics: ReportMetrics = {
    overall: ratesFrom(overallRow),
    perLens: selected.map((l) => ({
      lens: l,
      funnel: ratesFrom(rows.find((r) => r.lens === l) ?? zeroRow(l)),
    })),
  };

  // 4) By-lens signal grouping (Phase-2 per-lens generation input) — derived in JS from
  //    `signals`, so the cohort is identical to report.signals. A multi-lens signal
  //    appears under each selected lens it carries.
  const byLens = selected.map((l) => ({
    lens: l,
    signals: signals.filter((s) => s.lenses.includes(l)),
  }));

  return {
    range: { from, to },
    lenses: selected,
    generatedAt: new Date().toISOString(),
    signals,
    touches,
    metrics,
    byLens,
    narrative: { macroSurvey: null, perLens: {}, claimsRecap: null, callouts: {} },
  };
}

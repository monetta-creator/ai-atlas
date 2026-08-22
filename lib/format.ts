import type {
  ConvictionLabel, Resolvability, Direction, Weight,
  SignalContext, Significance, ConceptStatus,
} from './types';

export const RESOLVABILITY_LABEL: Record<Resolvability, string> = {
  clean: 'Clean',
  slow: 'Slow',
  qualitative: 'Qualitative',
};

// ---- Signal context ----
// The primary signal axis (transition D-005): where a development comes from.
// Order is the canonical display + filter order. Colors are theme-neutral CSS
// vars defined in app/styles/tokens.css.
export const SIGNAL_CONTEXT_SLUGS: SignalContext[] = ['internal', 'external'];

export const SIGNAL_CONTEXT_LABEL: Record<SignalContext, string> = {
  internal: 'Internal',
  external: 'External',
};

export const SIGNAL_CONTEXT_COLOR: Record<SignalContext, string> = {
  internal: 'var(--siglens-market)',
  external: 'var(--siglens-capability)',
};

export function signalContextColor(context: SignalContext): string {
  return SIGNAL_CONTEXT_COLOR[context] ?? 'var(--accent)';
}

// A touch code → its hypothesis page.
export function touchHref(code: string): string {
  return `/hypothesis/${encodeURIComponent(code)}`;
}

// ---- Concepts (the semantic scaffold) ----
export const CONCEPT_STATUS_LABEL: Record<ConceptStatus, string> = {
  settled: 'Settled',
  contested: 'Contested',
};

export const SIGNIFICANCE_LABEL: Record<Significance, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Significance reads on the warm end of the heat scale for High, neutral below.
export function significanceColor(s: Significance): string {
  return s === 'high' ? 'var(--heat-4)' : s === 'medium' ? 'var(--heat-2)' : 'var(--faint-ink)';
}

// ---- Conviction (the hypothesis-level judgment, D-017) ----
export function convictionText(label: ConvictionLabel): string {
  return label ? label[0].toUpperCase() + label.slice(1) : '–';
}

// Map a raw 0–1 conviction to its band — mirrors the Postgres conf_label() /
// the ConvictionEditor thresholds. Used by the calibration viewer.
export function convictionBand(c: number | null): ConvictionLabel {
  if (c == null) return null;
  if (c < 0.40) return 'thin';
  if (c < 0.60) return 'contested';
  if (c < 0.80) return 'leaning';
  return 'settled';
}

// The cool→warm conviction heat scale (Console design system). The four stored
// labels are placed on the five-step scale; warmer always means more-committed.
export function heatVar(label: ConvictionLabel): string {
  switch (label) {
    case 'settled': return 'var(--heat-4)';
    case 'leaning': return 'var(--heat-3)';
    case 'contested': return 'var(--heat-2)';
    case 'thin': return 'var(--heat-0)';
    default: return 'var(--ink-faint)';
  }
}

// How many of the five heat chips light up for a raw 0–1 conviction (admin only).
export function heatFill(conviction: number | null): number {
  if (conviction == null) return 0;
  return Math.min(5, Math.max(1, Math.round(conviction * 5)));
}

export function directionLabel(d: Direction): string {
  return d === 'supports' ? 'Supports' : d === 'contradicts' ? 'Contradicts' : 'Neutral';
}

export function directionColor(d: Direction): string {
  return d === 'supports' ? 'text-supports' : d === 'contradicts' ? 'text-contradicts' : 'text-depends';
}

// The evidence-link confidence words (D-017).
export const WEIGHT_LABEL: Record<Weight, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// "June 2026" for the share view's as-of dating.
export function asOfLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// "Jun 3, 2026" — full publication date for Signal Board cards/detail. Accepts a
// Date or ISO string (node-pg hands timestamptz back as a Date).
export function dateLabel(iso: string | Date | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Jun 1–6, 2026" (same month) / "Jun 1 – Jul 2, 2026" / cross-year. Inputs are
// 'YYYY-MM-DD'; parsed by parts to avoid timezone drift. Used in report titles.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !ty || !fm || !tm) return `${from} – ${to}`;
  if (fy === ty && fm === tm) return `${MONTHS_SHORT[fm - 1]} ${fd}–${td}, ${fy}`;
  if (fy === ty) return `${MONTHS_SHORT[fm - 1]} ${fd} – ${MONTHS_SHORT[tm - 1]} ${td}, ${fy}`;
  return `${MONTHS_SHORT[fm - 1]} ${fd}, ${fy} – ${MONTHS_SHORT[tm - 1]} ${td}, ${ty}`;
}

// ---- AI cost monitoring ----
// Cost-log feature slugs → human labels for the /costs dashboard. The slug
// (written by lib/cost.ts recordApiCall) is the source of truth; an unknown slug
// prettifies its own text. Lives here (not in server-only lib/cost.ts) so the
// client dashboard can import it. Retired slugs keep their labels so historic
// cost rows still read well.
const FEATURE_LABEL: Record<string, string> = {
  dossier: 'Source dossier',
  pdf_metadata: 'PDF metadata',
  hypothesis_recommendations: 'Hypothesis recommendations',
  claim_recommendations: 'Claim recommendations (retired)',
  signal_proposal: 'Signal proposal',
  pipeline_triage: 'Pipeline · triage',
  pipeline_analysis: 'Pipeline · analysis',
  draft_dedupe: 'Draft dedupe',
  report_context: 'Report · context section',
  report_synthesis: 'Report · synthesis',
  concept_prereqs: 'Concept prerequisites',
  concept_hypotheses: 'Concept hypothesis wiring',
  concept_gaps: 'Concept gap scan',
  argument_gaps: 'Hypothesis gap scan',
  hypothesis_gaps: 'Per-hypothesis gap scan',
  signal_analysis: 'Signal briefing + counterpoint',
  signal_ask: 'Ask this signal',
  ask: 'Ask the Atlas',
  portal_ask: 'Ask · portal',
  ask_deep: 'Ask · deep research',
  ask_verify: 'Ask · answer check',
  hypothesis_sections: 'Hypothesis report · sections',
  hypothesis_bottom_line: 'Hypothesis report · bottom line',
  research_triage: 'Research · triage',
  research_analysis: 'Research · paper analysis',
  research_synthesis: 'Research · thread synthesis',
  research_thread_scan: 'Research · thread scan',
  research_agent: 'Research · queue agent',
};

export function featureLabel(slug: string): string {
  return FEATURE_LABEL[slug] ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// "3 minutes ago" / "2 days ago" — compact relative time for admin activity rows.
export function timeAgo(iso: string | Date | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

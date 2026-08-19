import type {
  ConfidenceLabel, Domain, Resolvability, Lens, Relation, Direction,
  SignalLens, Significance, ConceptStatus, SheetKind,
  CompanyStatus, CompanyStage, CompanyEventKind, ScoutVerdict,
} from './types';

export const DOMAIN_LABEL: Record<Domain, string> = {
  capability: 'Capability',
  economics: 'Economics',
  build_out: 'Build-out',
  market: 'Market',
  labor: 'Labor',
};

export const RESOLVABILITY_LABEL: Record<Resolvability, string> = {
  clean: 'Clean',
  slow: 'Slow',
  qualitative: 'Qualitative',
};

export const LENS_LABEL: Record<Lens, string> = {
  market: 'Market',
  economics: 'Economics',
  social: 'Social',
  employment: 'Employment',
  education: 'Education',
  geopolitics: 'Geopolitics',
  stack: 'The stack',
};

// ---- Signal Board lenses ----
// The six audience-facing lenses (distinct from the argument map's Lens). Order here
// is the canonical display + filter order. Colors are theme-neutral CSS vars defined
// in app/styles/tokens.css, mirroring how the heat scale is referenced.
export const SIGNAL_LENS_SLUGS: SignalLens[] = [
  'market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society',
];

export const SIGNAL_LENS_LABEL: Record<SignalLens, string> = {
  market: 'Market & Valuation',
  labor: 'Labor & Knowledge Work',
  geopolitics: 'Geopolitics & Security',
  regulatory: 'Regulatory & Legal',
  capability: 'Technical Capability',
  society: 'Societal & Cultural',
};

export const SIGNAL_LENS_COLOR: Record<SignalLens, string> = {
  market: 'var(--siglens-market)',
  labor: 'var(--siglens-labor)',
  geopolitics: 'var(--siglens-geopolitics)',
  regulatory: 'var(--siglens-regulatory)',
  capability: 'var(--siglens-capability)',
  society: 'var(--siglens-society)',
};

export function signalLensLabel(lens: SignalLens): string {
  return SIGNAL_LENS_LABEL[lens] ?? lens;
}

export function signalLensColor(lens: SignalLens): string {
  return SIGNAL_LENS_COLOR[lens] ?? 'var(--accent)';
}

// A claim_touch code → its argument-map page. Bridge-claim codes are B1..Bn; every
// other code (incl. frames Fn) is a claim. The detail page resolves types from the DB;
// this heuristic is for the feed card where we only have the raw codes.
export function touchHref(code: string): string {
  return /^B\d/i.test(code) ? `/bridge/${code}` : `/claim/${encodeURIComponent(code)}`;
}

// ---- Concepts (the semantic scaffold) ----
// Settled rides the cool/leaning end of the heat scale; contested the committed-warm
// end — the same temperature language the confidence words use.
export const CONCEPT_STATUS_LABEL: Record<ConceptStatus, string> = {
  settled: 'Settled',
  contested: 'Contested',
};

export function conceptStatusColor(s: ConceptStatus): string {
  return s === 'contested' ? 'var(--heat-4)' : 'var(--heat-1)';
}

export const SIGNIFICANCE_LABEL: Record<Significance, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Significance reads on the warm end of the heat scale for High, neutral below.
export function significanceColor(s: Significance): string {
  return s === 'high' ? 'var(--heat-4)' : s === 'medium' ? 'var(--heat-2)' : 'var(--faint-ink)';
}

export function confidenceText(label: ConfidenceLabel): string {
  return label ? label[0].toUpperCase() + label.slice(1) : '–';
}

// Map a raw 0–1 confidence to its band — mirrors the Postgres conf_label() / the
// ConfidenceEditor thresholds. Used by the calibration viewer to band snapshot values.
export function confidenceBand(c: number | null): ConfidenceLabel {
  if (c == null) return null;
  if (c < 0.40) return 'thin';
  if (c < 0.60) return 'contested';
  if (c < 0.80) return 'leaning';
  return 'settled';
}

export function confidenceColor(label: ConfidenceLabel): string {
  switch (label) {
    case 'settled': return 'text-settled';
    case 'leaning': return 'text-leaning';
    case 'contested': return 'text-contested';
    case 'thin': return 'text-thin';
    default: return 'text-ink-faint';
  }
}

export function confidenceDot(label: ConfidenceLabel): string {
  switch (label) {
    case 'settled': return 'bg-settled';
    case 'leaning': return 'bg-leaning';
    case 'contested': return 'bg-contested';
    case 'thin': return 'bg-thin';
    default: return 'bg-ink-faint';
  }
}

// The cool→warm confidence heat scale (Console design system). The four stored
// labels are placed on the five-step scale; warmer always means more-committed.
//   thin → heat-0 (cool) · contested → heat-2 · leaning → heat-3 · settled → heat-4 (warm)
export function heatVar(label: ConfidenceLabel): string {
  switch (label) {
    case 'settled': return 'var(--heat-4)';
    case 'leaning': return 'var(--heat-3)';
    case 'contested': return 'var(--heat-2)';
    case 'thin': return 'var(--heat-0)';
    default: return 'var(--ink-faint)';
  }
}

// How many of the five heat chips light up for a raw 0–1 confidence (admin only).
export function heatFill(confidence: number | null): number {
  if (confidence == null) return 0;
  return Math.min(5, Math.max(1, Math.round(confidence * 5)));
}

export function relationColor(rel: Relation): string {
  switch (rel) {
    case 'supports': return 'text-supports';
    case 'contradicts': return 'text-contradicts';
    default: return 'text-depends';
  }
}

export function relationStroke(rel: Relation): string {
  switch (rel) {
    case 'supports': return 'var(--color-supports)';
    case 'contradicts': return 'var(--color-contradicts)';
    default: return 'var(--color-depends)';
  }
}

export function directionLabel(d: Direction): string {
  return d === 'supports' ? 'Supports' : d === 'contradicts' ? 'Contradicts' : 'Neutral';
}

export function directionColor(d: Direction): string {
  return d === 'supports' ? 'text-supports' : d === 'contradicts' ? 'text-contradicts' : 'text-depends';
}

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

// "Jun 1–6, 2026" (same month) / "Jun 1 – Jul 2, 2026" / cross-year. Inputs are 'YYYY-MM-DD';
// parsed by parts to avoid timezone drift. Used in report titles.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !ty || !fm || !tm) return `${from} – ${to}`;
  if (fy === ty && fm === tm) return `${MONTHS_SHORT[fm - 1]} ${fd}–${td}, ${fy}`;
  if (fy === ty) return `${MONTHS_SHORT[fm - 1]} ${fd} – ${MONTHS_SHORT[tm - 1]} ${td}, ${fy}`;
  return `${MONTHS_SHORT[fm - 1]} ${fd}, ${fy} – ${MONTHS_SHORT[tm - 1]} ${td}, ${ty}`;
}

// ---- AI cost monitoring (migration 0014) ----
// Cost-log feature slugs → human labels for the /costs dashboard. The slug (written by
// lib/cost.ts recordApiCall) is the source of truth; an unknown slug prettifies its own text.
// Lives here (not in the server-only lib/cost.ts) so the client dashboard can import it.
export const FEATURE_LABEL: Record<string, string> = {
  dossier: 'Source dossier',
  pdf_metadata: 'PDF metadata',
  claim_recommendations: 'Claim recommendations',
  lens_recommendations: 'Lens recommendations',
  question_summary: 'Question summary',
  landscape_narration: 'Landscape narration',
  signal_proposal: 'Signal proposal',
  pipeline_discovery: 'Pipeline · discovery (web search)',
  pipeline_triage: 'Pipeline · triage',
  pipeline_analysis: 'Pipeline · analysis',
  pipeline_coverage: 'Pipeline · coverage check (web search)',
  draft_dedupe: 'Draft dedupe',
  report_lens: 'Report · lens section',
  report_synthesis: 'Report · synthesis',
  concept_prereqs: 'Concept prerequisites',
  concept_claims: 'Concept claim wiring',
  concept_gaps: 'Concept gap scan',
  signal_analysis: 'Signal briefing + counterpoint',
  signal_ask: 'Ask this signal',
  ask: 'Ask the Atlas',
  portal_ask: 'Ask · portal',
  ask_deep: 'Ask · deep research',
  ask_verify: 'Ask · answer check',
  tearsheet_sections: 'Report Portal · sections',
  tearsheet_close: 'Report Portal · bottom line',
  thesis_map: 'Thesis · claim mapping',
  thesis_gaps: 'Thesis · gap diagnosis',
  thesis_sections: 'Thesis report · sections',
  thesis_bottom_line: 'Thesis report · bottom line',
  scout_discovery: 'Scout · discovery (web search)',
  scout_agent: 'Scout · queue scoring',
  scout_dossier: 'Scout · company dossier',
  scout_intel: 'Scout · web intel sweep (web search)',
  scout_doc: 'Scout · document extraction',
  scout_competitors: 'Scout · competitor scan (web search)',
  portal_scout: 'Scout · portal research',
};

// ---- Startup Scout (migration 0034) ----
export const COMPANY_STATUS_LABEL: Record<CompanyStatus, string> = {
  queued: 'Queued',
  tracked: 'Tracked',
  dismissed: 'Dismissed',
  archived: 'Archived',
};

export const COMPANY_STAGE_LABEL: Record<CompanyStage, string> = {
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
  later: 'Later stage',
  unknown: 'Stage unknown',
};

export const COMPANY_EVENT_LABEL: Record<CompanyEventKind, string> = {
  funding: 'Funding',
  launch: 'Launch',
  news: 'News',
  milestone: 'Milestone',
  note: 'Note',
};

export const SCOUT_VERDICT_LABEL: Record<ScoutVerdict, string> = {
  pursue: 'Pursue',
  watch: 'Watch',
  pass: 'Pass',
};

// Pursue rides the supports green, watch the mid heat, pass stays quiet.
export function scoutVerdictColor(v: ScoutVerdict): string {
  return v === 'pursue' ? 'var(--supports)' : v === 'watch' ? 'var(--heat-2)' : 'var(--faint-ink)';
}

// ---- The Report Portal's generated reports (tear sheets) ----
// Lives here (not in the server-only lib/tearsheet/generate.ts, which pulls the
// Anthropic SDK) so client components can label kinds and sections.
export const SHEET_KIND_LABEL: Record<SheetKind, string> = {
  claim: 'Claim tear sheet',
  bridge: 'Bridge-claim tear sheet',
  lens: 'Lens deep report',
  atlas: 'Executive briefing',
};

export const SHEET_SECTION_TITLES: Record<SheetKind, { reading: string; connections: string; watch: string }> = {
  claim: { reading: 'Where the evidence stands', connections: 'How it wires into the argument', watch: 'What would move it' },
  bridge: { reading: 'Where the evidence stands', connections: 'How it wires into the argument', watch: 'What would move it' },
  lens: { reading: 'What happened through this lens', connections: 'The cross-claim read', watch: 'What to watch' },
  atlas: { reading: 'Where the debate stands', connections: 'What moved', watch: 'What to watch' },
};

export function featureLabel(slug: string): string {
  return FEATURE_LABEL[slug] ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'not yet moved';
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

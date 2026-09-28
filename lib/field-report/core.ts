// Field Report: Ask's research-report mode (2026-09-28; docs/field-report.md).
// The pure core: types shared by the engine, the routes and the UI; plan
// validation; the report markdown parser with provenance labels; citation
// linking; estimates; the run's step list. One type-only import, zero DB: tested from
// plain Node by scripts/test-field-report.mjs.

import type { SavantFigure } from '../savant/figures-core';

export type FieldReportSize = 'brief' | 'full';
export const FIELD_REPORT_SIZES: FieldReportSize[] = ['brief', 'full'];

// ---- the plan ------------------------------------------------------------------
export interface FieldReportPlan {
  title: string;              // the report's working title, plain text
  objective: string;          // the sharpened question, one or two sentences
  sub_questions: string[];    // 3-6: each becomes a research track and a section
  considerations: string[];   // angles the asker may not have raised
  atlas_focus: string[];      // the Atlas records, positions and threads it will check
  web_gaps: string[];         // what it will look for on the web
  out_of_scope: string[];     // what it will deliberately not cover
  recommended_size: FieldReportSize;
}

export const PLAN_LIMITS = { subMin: 2, subMax: 6, listMax: 6, lineMax: 300, titleMax: 120, objectiveMax: 600 } as const;

const clean = (s: unknown, max: number): string =>
  String(s ?? '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => clean(x, PLAN_LIMITS.lineMax)).filter(Boolean).slice(0, max);

// Coerce a model's (or an editor's) plan into the valid shape. Returns an
// error string when it cannot be made usable: a report needs an objective and
// at least two sub-questions.
export function validatePlan(raw: unknown): FieldReportPlan | string {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const plan: FieldReportPlan = {
    title: clean(o.title, PLAN_LIMITS.titleMax),
    objective: clean(o.objective, PLAN_LIMITS.objectiveMax),
    sub_questions: cleanList(o.sub_questions, PLAN_LIMITS.subMax),
    considerations: cleanList(o.considerations, PLAN_LIMITS.listMax),
    atlas_focus: cleanList(o.atlas_focus, PLAN_LIMITS.listMax),
    web_gaps: cleanList(o.web_gaps, PLAN_LIMITS.listMax),
    out_of_scope: cleanList(o.out_of_scope, PLAN_LIMITS.listMax),
    recommended_size: o.recommended_size === 'full' ? 'full' : 'brief',
  };
  if (!plan.objective) return 'The plan needs an objective.';
  if (plan.sub_questions.length < PLAN_LIMITS.subMin) return `The plan needs at least ${PLAN_LIMITS.subMin} sub-questions.`;
  if (!plan.title) plan.title = plan.objective.slice(0, PLAN_LIMITS.titleMax);
  return plan;
}

// ---- the run's steps (ui_jobs) ----------------------------------------------------
export interface FieldReportStep { key: string; label: string; running: string; features: string[] }

export function fieldReportSteps(size: FieldReportSize): FieldReportStep[] {
  const steps: FieldReportStep[] = [
    { key: 'atlas', label: 'Atlas research', running: 'Researching the Atlas records', features: ['field_report_research'] },
    { key: 'web', label: 'Web gap-fill', running: 'Searching the web for gaps and new angles', features: ['field_report_web'] },
    { key: 'write', label: 'Writing', running: 'Writing the report', features: ['field_report_write'] },
  ];
  if (size === 'full') {
    steps.push(
      { key: 'editor', label: 'Editor review', running: 'The editor is reading the draft', features: ['field_report_editor'] },
      { key: 'revise', label: 'Revision', running: 'Revising what the editor flagged', features: ['field_report_revise'] },
      { key: 'figures', label: 'Figures', running: 'Planning the figures', features: ['field_report_figures'] },
    );
  }
  steps.push({ key: 'save', label: 'Saving', running: 'Checking every link and saving', features: [] });
  return steps;
}

// ---- the ledger ------------------------------------------------------------------------
export interface LedgerRecord { tag: string; kind: string; href: string; title: string }
export interface WebSource { id: string; url: string; title: string; date: string | null }

// ---- provenance ----------------------------------------------------------------------
export type Provenance = 'atlas' | 'web' | 'mixed' | 'analysis';
export type BlockKind = 'p' | 'ul' | 'ol' | 'h3' | 'quote';
export interface ReportBlock {
  kind: BlockKind;
  md: string;              // the block's markdown, citations still as tags
  prov: Provenance;
  labeled: boolean;        // true when the writer put it in an :::analysis block
}
export interface ReportSectionDraft { key: string; title: string; blocks: ReportBlock[] }

// Atlas citation tokens the tools print, plus the web ids this run mints.
const ATLAS_TAG_RE = /\[(?:(?:signal|paper|item|fact|report|history)\s+)?[SPIXRH]\d{1,4}\]|\[(?:claim|bridge|stance|Q|question|concept|thread)\s+[A-Za-z0-9.\-]+\]|\[(?:Q\d-S\d[A-C]|B\d{1,2}|\d\.\d{1,2})\]|\]\(\/(?:claim|bridge|q|concepts|research|signals|reports|savant|blotter)[^)]*\)/;
const WEB_TAG_RE = /\[(?:web\s+)?W\d{1,3}\]/;

export function provenanceOf(md: string, labeledAnalysis: boolean): Provenance {
  if (labeledAnalysis) return 'analysis';
  const atlas = ATLAS_TAG_RE.test(md);
  const web = WEB_TAG_RE.test(md);
  if (atlas && web) return 'mixed';
  if (atlas) return 'atlas';
  if (web) return 'web';
  return 'analysis'; // an unsourced paragraph never reads as sourced
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'section';

// Parse the writer's markdown: "## " opens a section; inside, blank-line
// separated blocks; ":::analysis" ... ":::" fences mark the writer's own
// reasoning. A "# " title line is ignored (the title travels separately).
export function parseReportMarkdown(md: string): ReportSectionDraft[] {
  const sections: ReportSectionDraft[] = [];
  let current: ReportSectionDraft | null = null;
  let inAnalysis = false;
  let buf: string[] = [];
  const keys = new Set<string>();
  const flush = () => {
    const text = buf.join('\n').trim();
    buf = [];
    if (!text || !current) return;
    const kind: BlockKind = /^(\s*[-*]\s+)/.test(text) ? 'ul' : /^\s*\d+[.)]\s+/.test(text) ? 'ol' : /^###\s+/.test(text) ? 'h3' : /^>\s?/.test(text) ? 'quote' : 'p';
    if (kind === 'ul' || kind === 'ol') {
      // One block per list item, so each bullet carries its own provenance.
      const items = text.split(/\n(?=\s*(?:[-*]|\d+[.)])\s+)/).map((x) => x.trim()).filter(Boolean);
      for (const item of items) current.blocks.push({ kind, md: item, prov: provenanceOf(item, inAnalysis) || 'analysis', labeled: inAnalysis });
      return;
    }
    const body = kind === 'h3' ? text.replace(/^###\s+/, '') : text;
    current.blocks.push({ kind, md: body, prov: kind === 'h3' ? 'analysis' : provenanceOf(body, inAnalysis), labeled: inAnalysis });
  };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    if (/^#\s+/.test(line)) continue;
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      flush();
      inAnalysis = false;
      let key = slug(h[1]);
      while (keys.has(key)) key = `${key}-x`;
      keys.add(key);
      current = { key, title: h[1].replace(/\s*—\s*/g, ', ').trim(), blocks: [] };
      sections.push(current);
      continue;
    }
    if (/^:::\s*analysis\s*$/i.test(line.trim())) { flush(); inAnalysis = true; continue; }
    if (/^:::\s*$/.test(line.trim())) { flush(); inAnalysis = false; continue; }
    if (!current) { current = { key: 'summary', title: 'Summary', blocks: [] }; sections.push(current); keys.add('summary'); }
    if (!line.trim()) { flush(); continue; }
    // A subheading is always its own block, even with no blank line after it.
    if (/^###\s+/.test(line)) { flush(); buf.push(line); flush(); continue; }
    buf.push(line);
  }
  flush();
  return sections.filter((s) => s.blocks.length);
}

export interface ProvenanceShare { atlas: number; web: number; mixed: number; analysis: number }
export function provenanceShare(sections: { blocks: { kind: BlockKind; prov: Provenance }[] }[]): ProvenanceShare {
  const n: ProvenanceShare = { atlas: 0, web: 0, mixed: 0, analysis: 0 };
  for (const s of sections) for (const b of s.blocks) if (b.kind !== 'h3') n[b.prov] += 1;
  return n;
}

// ---- citation linking -------------------------------------------------------------------
// Tags become numbered footnote links, one number per distinct href in order of
// first use, so the gate sees real links. Atlas tags resolve through tagHrefs
// (S3 -> /signals/<id>) and codeHrefs ("claim:3.1" -> /claim/3.1); web ids
// through webHrefs (W4 -> url). A tag with no href is dropped.
export function linkifyTags(
  md: string,
  maps: { tagHrefs: Map<string, string>; codeHrefs: Map<string, string>; webHrefs: Map<string, string> },
  used: Map<string, number> = new Map(),
): string {
  const num = (href: string) => { if (!used.has(href)) used.set(href, used.size + 1); return used.get(href)!; };
  const TOKEN = /\[(?:(?:signal|paper|item|fact|report|history)\s+)?([SPIXRH]\d{1,4})\]|\[(?:web\s+)?(W\d{1,3})\]|\[(claim|bridge|stance|Q|question|concept|thread)\s+([A-Za-z0-9.\-]+)\]|\[(Q\d-S\d[A-C]|B\d{1,2}|\d\.\d{1,2})\]/g;
  return md.replace(TOKEN, (_m, tag?: string, web?: string, kind?: string, code?: string, bare?: string) => {
    let href: string | undefined;
    if (tag) href = maps.tagHrefs.get(tag);
    else if (web) href = maps.webHrefs.get(web);
    else if (kind && code) href = maps.codeHrefs.get(`${kind === 'Q' || kind === 'question' ? 'question' : kind}:${code}`);
    else if (bare) href = maps.codeHrefs.get(`${bare.startsWith('Q') ? 'stance' : bare.startsWith('B') ? 'bridge' : 'claim'}:${bare}`);
    return href ? `[${num(href)}](${href})` : '';
  }).replace(/\s+([.,;:])/g, '$1').replace(/\)\s*\[(\d+)\]\(/g, ') [$1](');
}

// ---- deterministic checks -------------------------------------------------------------
const MACHINERY = /\b(argument map|confidence (?:score|level)|logic tree|the atlas's claim|record id|tool call|search_atlas|fetch_record|memos?|memo authors|web pass|research tracks?)\b/i;
export interface DraftIssue { section: string; issue: string }
export function draftIssues(sections: ReportSectionDraft[]): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.md.includes('—')) out.push({ section: s.key, issue: 'uses an em dash' });
      if (MACHINERY.test(b.md)) out.push({ section: s.key, issue: `names the machinery: "${b.md.match(MACHINERY)?.[0]}"` });
      if (b.kind !== 'h3' && b.prov === 'analysis' && !b.labeled && b.md.length > 200) {
        out.push({ section: s.key, issue: `an unsourced paragraph was not marked as analysis: "${b.md.slice(0, 80)}"` });
      }
    }
  }
  return out;
}

// ---- estimates -------------------------------------------------------------------------
// Tokens per leg per size, a first guess refined once real runs are measured
// (the desk later reads medians from ai_cost_log per field_report_<leg>).
export const TOKEN_PROFILE: Record<FieldReportSize, Record<string, { input: number; output: number; searches?: number }>> = {
  brief: {
    research: { input: 90_000, output: 9_000 },
    web: { input: 60_000, output: 5_000, searches: 4 },
    write: { input: 35_000, output: 7_000 },
  },
  full: {
    research: { input: 260_000, output: 24_000 },
    web: { input: 160_000, output: 12_000, searches: 12 },
    write: { input: 70_000, output: 14_000 },
    editor: { input: 25_000, output: 2_500 },
    revise: { input: 30_000, output: 9_000 },
    figures: { input: 20_000, output: 3_000 },
  },
};
export const ROLE_OF_LEG: Record<string, 'research' | 'writer' | 'editor' | 'figures'> = {
  research: 'research', web: 'research', write: 'writer', revise: 'writer', editor: 'editor', figures: 'figures',
};
export const MINUTES: Record<FieldReportSize, [number, number]> = { brief: [3, 5], full: [7, 11] };
export const WEB_SEARCH_USD = 0.01;
// Claude 4.7+ tokenizers count about 30% more tokens for the same text.
const tokenFactor = (model: string) => (/claude-(sonnet-5|opus-5|fable-5|opus-4-7|sonnet-4-7)/.test(model) ? 1.3 : 1);

export interface Rate { input: number; output: number } // USD per million tokens
export function estimateUsd(size: FieldReportSize, models: Record<'research' | 'writer' | 'editor' | 'figures', string>, rates: Map<string, Rate>): number {
  let usd = 0;
  for (const [leg, t] of Object.entries(TOKEN_PROFILE[size])) {
    const model = models[ROLE_OF_LEG[leg]];
    const r = rates.get(model);
    if (r) usd += ((t.input * r.input + t.output * r.output) / 1e6) * tokenFactor(model);
    usd += (t.searches ?? 0) * WEB_SEARCH_USD;
  }
  return Math.round(usd * 100) / 100;
}

// ---- caps ----------------------------------------------------------------------------------
export function capRoom(spentUsd: number, capUsd: number): number {
  return Math.max(0, Math.round((capUsd - spentUsd) * 100) / 100);
}

// ---- what is saved (generated_reports kind 'field_report') -----------------------------
export interface RenderedBlock { kind: BlockKind; html: string; prov: Provenance }
export interface RenderedSection { key: string; title: string; blocks: RenderedBlock[] }
export interface ResearchLogEntry { track: string; tool: string; query: string; results: number; round: number }

export interface FieldReportPack {
  kind: 'field_report';
  runId: string;
  question: string;
  plan: FieldReportPlan;
  size: FieldReportSize;
  models: Record<'research' | 'writer' | 'editor' | 'figures', string>;
  research: { log: ResearchLogEntry[]; rounds: number; webSearches: number; dropped: string[] };
  records: LedgerRecord[];   // Atlas records gathered (tag, kind, href, title)
  web: WebSource[];          // web sources gathered (W1..)
  provenance: ProvenanceShare;
  costUsd: number;
  createdBy: string;         // 'admin' | 'key:<id>'
  generatedAt: string;       // ISO
}

export interface FieldReportNarrative {
  title: string;
  summary: RenderedBlock[];            // the Summary section's blocks (bullets)
  sections: RenderedSection[];         // every other section, in order
  editor: { name: string; verdict: string; note: string } | null;
  figures: unknown[];                  // SavantFigure[] when Full planned figures
}

// ---- API contracts ----------------------------------------------------------------------
// POST /api/field-report/plan  { question, context?, note?, previousRunId? }
export interface FieldReportPlanResponse {
  runId: string;
  plan: FieldReportPlan;
  estimates: Record<FieldReportSize, { usd: number; minutes: [number, number] }>;
  capRoomUsd: number | null;           // null for admin (uncapped)
}
// POST /api/field-report/run  { runId, plan, size }  (also resumes a paused run)
export interface FieldReportRunResponse { runId: string; jobId: string }
// GET /api/field-report/<runId>
export interface FieldReportCard {
  id: string;                          // generated_reports id
  title: string;
  summary: string[];                   // plain-text summary bullets
  provenance: ProvenanceShare;
  href: string;                        // /field-reports/<id>
  pdfHref: string;                     // /field-reports/<id>/pdf
  isPublished: boolean;
  size: FieldReportSize;
  costUsd: number;
}
export interface FieldReportRunStatus {
  run: { id: string; status: 'planned' | 'running' | 'paused' | 'done' | 'failed'; size: FieldReportSize; title: string; jobId: string | null; error: string | null };
  report: FieldReportCard | null;
}

// ---- figures ------------------------------------------------------------------------
// A report built on disagreeing evidence tempts the planner to set numbers
// from different studies side by side as if they measured one thing (the
// first live Full run did exactly that with three benchmark scores its own
// text called incomparable, then, told to use one source, pinned all three
// on one page). So a compare chart here must take every bar from ONE source,
// and each bar's number must appear in the text that source's footnote
// covers. `textByHref` comes from textBySource.
export function checkCompares(figures: SavantFigure[], textByHref: Map<string, string>): { figures: SavantFigure[]; dropped: string[] } {
  const dropped: string[] = [];
  const stated = (value: number, href: string) => {
    const text = (textByHref.get(href) ?? '').replace(/(\d),(\d{3})/g, '$1$2');
    const forms = new Set([String(value), value.toFixed(1), value.toFixed(2)].map((f) => f.replace(/\.0+$/, '')));
    return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(text));
  };
  const kept = figures.filter((f) => {
    if (f.kind !== 'compare') return true;
    const sources = new Set(f.bars.map((b) => b.href ?? ''));
    if (sources.size > 1 || sources.has('')) { dropped.push(`${f.id} (compare): bars drawn from ${sources.size} sources`); return false; }
    const unstated = f.bars.filter((b) => !stated(b.value, b.href ?? ''));
    if (unstated.length) { dropped.push(`${f.id} (compare): ${unstated.map((b) => b.label).join(', ')} not stated beside that source`); return false; }
    return true;
  });
  return { figures: kept.map((f, i) => ({ ...f, id: `fig-${i + 1}` })), dropped };
}

// Footnote attribution: the text a link vouches for is the run since the
// previous link in the same block (or the block's start), so "A was 33.4%
// [1], B was 47.2 [2]" gives 33.4 to source 1 and 47.2 to source 2 even in
// one sentence. What checkCompares reads to confirm a bar's number sits
// beside its source, keyed by href.
export function textBySource(sections: RenderedSection[], plain: (html: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sections) for (const b of s.blocks) {
    let from = 0;
    for (const m of b.html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      out.set(href, `${out.get(href) ?? ''} ${plain(b.html.slice(from, m.index))}`);
      from = m.index + m[0].length;
    }
  }
  return out;
}

// ---- appendices ----------------------------------------------------------------------
// Appendix A in brief: per sub-question (track T1 is the plan's first), how
// many searches ran, how many records were read, and the distinct queries.
// The full log stays in the pack; a reader needs the shape, not every row.
export interface ResearchDigest { label: string; searches: number; reads: number; queries: string[] }
export function researchDigest(log: ResearchLogEntry[], subQuestions: string[], maxQueries = 8): ResearchDigest[] {
  const byTrack = new Map<string, ResearchDigest>();
  for (const e of log) {
    const web = e.tool === 'web_search' || e.track === 'web';
    const n = /^T(\d+)$/.exec(e.track)?.[1];
    const label = web ? 'The web, for what the Atlas did not hold' : (n && subQuestions[Number(n) - 1]) || e.track;
    const d = byTrack.get(label) ?? { label, searches: 0, reads: 0, queries: [] };
    if (e.tool === 'fetch_record') d.reads += 1;
    else {
      d.searches += 1;
      const q = e.query.trim();
      if (q && d.queries.length < maxQueries && !d.queries.some((x) => x.toLowerCase() === q.toLowerCase())) d.queries.push(q);
    }
    byTrack.set(label, d);
  }
  // Plan order, then anything else, the web last.
  const rank = (label: string) => { const i = subQuestions.indexOf(label); return i >= 0 ? i : label.startsWith('The web') ? 1e6 : 1e5; };
  return [...byTrack.values()].sort((a, b) => rank(a.label) - rank(b.label));
}

// Appendix B's label for a cited href: the record's or web page's own title.
export function sourceTitles(records: LedgerRecord[], web: WebSource[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of records) if (r.title && r.title !== r.tag) out.set(r.href, r.title);
  for (const w of web) if (w.title) out.set(w.url, w.title);
  return out;
}

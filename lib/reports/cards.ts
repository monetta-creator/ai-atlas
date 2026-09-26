import { SHEET_KIND_LABEL, SIGNAL_LENS_LABEL, dateLabel, formatDateRange } from '../format.ts';
import type { GeneratedReportMeta, SavedReportMeta, SignalLens } from '../types';
import type { ThesisTrackerEntry } from '../data/desk';
import type { DeckEntry } from './decks.ts';

// Pure card-shaping for the Report Portal grid (app/reports/page.tsx +
// components/reports/ReportGrid.tsx). No @/lib/db import anywhere in this
// file or its dependencies (format.ts is pure, the desk.ts import is
// type-only and erased at compile time) so this is safe to import from a
// 'use client' component, and relative (not '@/...') so plain-Node type
// stripping can load it in scripts/test-reports-cards.mjs.

export type ReportFamily = 'sheet' | 'period' | 'thesis' | 'deck';

export interface ReportCard {
  id: string;
  family: ReportFamily;
  kind: string; // sheet kinds as stored; 'period'; 'thesis'
  kindLabel: string;
  title: string;
  subject: string | null;
  metaLines: string[]; // what the PDF cover shows under the subject
  abstract: string | null; // sheet bottom line (already plain text); null for others
  chips: string[]; // deterministic stats
  date: string; // display date (dateLabel of generated_at / saved); decks say "Live" or "Evergreen"
  sortDate: string; // ISO-ish for sorting desc; '' = undated (decks), sorted after every dated report
  href: string;
  pdfHref: string;
  isPublished: boolean;
  access?: 'admin' | 'portal' | 'public'; // decks and portal-only sheet kinds; admin decks carry real spend
}

export const PAGE_SIZE = 15;

// ---------------------------------------------------------------- sheet

export function toSheetCard(meta: GeneratedReportMeta): ReportCard {
  const subjectLabel =
    meta.kind === 'lens' ? SIGNAL_LENS_LABEL[meta.subject as SignalLens] ?? meta.subject :
    meta.kind === 'atlas' ? 'Whole Atlas' :
    meta.kind === 'edition' ? (meta.scope_to ? dateLabel(meta.scope_to) : 'Today') :
    meta.kind === 'intel_deck' ? (meta.scope_to ? dateLabel(meta.scope_to) : 'Today') :
    meta.kind === 'roundup'
      ? (meta.scope_from && meta.scope_to
          ? `Week of ${dateLabel(meta.scope_from)} to ${dateLabel(meta.scope_to)}`
          : 'This week')
      : meta.kind === 'tooling_entrants'
      ? (meta.scope_to ? `Week ending ${dateLabel(meta.scope_to)}` : 'This week')
      // tooling_landscape / tooling_features carry the category name, tooling_brief
      // the capability text; both are already stored human-readable in `subject`.
      : meta.subject;

  // The deterministic stat line, per kind (claim/bridge carry evidence stats,
  // lens carries signal stats + code coverage, atlas carries map health,
  // roundup carries its own weekly counts).
  const chips: string[] = [];
  const s = meta.stats;
  if (meta.kind === 'intel_deck' && s) {
    if (s.companies !== undefined) chips.push(`${s.companies} companies`);
    if (s.movers !== undefined) chips.push(`${s.movers} moves`);
    if (s.quiet !== undefined) chips.push(`${s.quiet} quiet`);
  } else if (meta.kind === 'roundup' && s) {
    const papers = (s.papersTracked ?? 0) + (s.papersNoted ?? 0);
    chips.push(`${papers} papers`);
    if (s.findings !== undefined) chips.push(`${s.findings} findings`);
    if (s.threadsUpdated) chips.push(`${s.threadsUpdated} threads updated`);
    if (s.risingRejects) chips.push(`${s.risingRejects} rising rejects`);
  } else if (meta.kind.startsWith('tooling_') && s) {
    if (s.products !== undefined) chips.push(`${s.products} products`);
    if (s.entrants !== undefined) chips.push(`${s.entrants} new entrants`);
    if (s.features !== undefined) chips.push(`${s.features} feature tags`);
  } else if (s?.evidence) {
    chips.push(`${s.evidence.total} evidence: ${s.evidence.supports} support / ${s.evidence.contradicts} contradict / ${s.evidence.neutral} neutral`);
    if (s.signals?.total !== undefined) chips.push(`${s.signals.total} signals`);
    if (s.evidence.oneSided) chips.push('⚠ one-sided');
  } else if (s?.signals) {
    const d = s.signals.byDirection;
    chips.push(`${s.signals.total} signals: ${d.supports} support / ${d.contradicts} contradict / ${d.neutral} neutral${d.untyped > 0 ? ` / ${d.untyped} no direction` : ''}`);
    if (s.codes !== undefined) chips.push(`${s.codes} claims covered`);
  } else if (meta.health) {
    const h = meta.health;
    chips.push(`${h.claims} claims · ${h.bridges} bridges · ${h.evidence} evidence rows · ${h.signalsPublished} signals`);
    if (h.uncovered > 0) chips.push(`${h.uncovered} uncovered`);
    if (h.oneSided > 0) chips.push(`${h.oneSided} one-sided`);
  }
  const evidenceWindow = s?.signals?.firstPublished && s?.signals?.lastPublished
    ? `evidence spans ${s.signals.firstPublished.slice(0, 10)} to ${s.signals.lastPublished.slice(0, 10)}`
    : null;
  if (evidenceWindow) chips.push(evidenceWindow);

  const scopeLine = meta.scope_from && meta.scope_to
    ? `Scope: ${meta.scope_from} to ${meta.scope_to}`
    : meta.scope_from
    ? `Scope: from ${meta.scope_from}`
    : meta.scope_to
    ? `Scope: through ${meta.scope_to}`
    : 'Scope: full corpus';

  return {
    id: meta.id,
    family: 'sheet',
    kind: meta.kind,
    kindLabel: SHEET_KIND_LABEL[meta.kind],
    title: meta.title,
    subject: subjectLabel ?? null,
    metaLines: [scopeLine, `Generated ${meta.generated_at.slice(0, 10)}`],
    abstract: meta.abstract ?? null,
    chips,
    date: dateLabel(meta.generated_at) ?? meta.generated_at.slice(0, 10),
    sortDate: meta.generated_at,
    // The edition reads on the blotter, not the generic sheet view, and its PDF
    // is the blotter's newspaper PDF (the 16:9 deck sits at /deck/pdf): the
    // sheet PDF route renders a tear-sheet layout over an edition pack and fails.
    href: meta.kind === 'edition' && meta.scope_to ? `/blotter/${meta.scope_to}`
      : meta.kind === 'intel_deck' && meta.scope_to ? `/intel/deck/${meta.scope_to}`
      : `/reports/sheet/${meta.id}`,
    pdfHref: meta.kind === 'edition' && meta.scope_to ? `/blotter/${meta.scope_to}/pdf`
      : meta.kind === 'intel_deck' && meta.scope_to ? `/intel/deck/${meta.scope_to}/pdf`
      : `/reports/sheet/${meta.id}/pdf`,
    // The company intel deck names tracked companies: keyholders and admin only.
    ...(meta.kind === 'intel_deck' ? { access: 'portal' as const } : {}),
    isPublished: meta.is_published,
  };
}

// ---------------------------------------------------------------- period

export function toPeriodCard(meta: SavedReportMeta): ReportCard {
  const subject = meta.lenses.map((l) => SIGNAL_LENS_LABEL[l] ?? l).join(', ');
  return {
    id: meta.id,
    family: 'period',
    kind: 'period',
    kindLabel: 'Period report',
    title: meta.title,
    subject: subject || null,
    metaLines: [
      `Period: ${formatDateRange(meta.date_from, meta.date_to)}`,
      `Saved ${meta.updated_at.slice(0, 10)}`,
    ],
    abstract: null,
    chips: [`${meta.lenses.length} lens${meta.lenses.length === 1 ? '' : 'es'}`],
    date: dateLabel(meta.updated_at) ?? meta.updated_at.slice(0, 10),
    sortDate: meta.updated_at,
    href: `/reports/${meta.id}`,
    pdfHref: `/reports/${meta.id}/pdf`,
    isPublished: true,
  };
}

// ---------------------------------------------------------------- thesis

export function toThesisCard(e: ThesisTrackerEntry): ReportCard {
  return {
    id: e.report_id,
    family: 'thesis',
    kind: 'thesis',
    kindLabel: 'Thesis report',
    title: e.title,
    subject: e.statement,
    metaLines: [`Generated ${e.generated_at.slice(0, 10)}`],
    abstract: null,
    chips: [
      `${e.matched} signals matched`,
      `${e.supports} support / ${e.contradicts} contradict / ${e.mixed} mixed`,
    ],
    date: dateLabel(e.generated_at) ?? e.generated_at.slice(0, 10),
    sortDate: e.generated_at,
    href: `/thesis-report/${e.report_id}`,
    pdfHref: `/thesis-report/${e.report_id}/pdf`,
    isPublished: true,
  };
}

// ---------------------------------------------------------------- deck

// A 16:9 slide deck (lib/reports/decks.ts). Undated on purpose: the live
// decks rebuild their numbers on open, the guide decks are evergreen copy,
// so sortDate is '' and sortCards places them after every dated report.
export function toDeckCard(d: DeckEntry): ReportCard {
  const chips: string[] = [];
  if (d.slides) chips.push(`${d.slides} slides`);
  chips.push(d.live ? 'live numbers, rebuilt on open' : 'fixed editorial copy');
  if (d.access === 'admin') chips.push('admin only');
  return {
    id: d.id,
    family: 'deck',
    kind: 'deck',
    kindLabel: '16:9 deck',
    title: d.title,
    subject: d.subtitle,
    metaLines: [d.kicker, d.live ? 'Numbers as of the day it is opened' : `${d.slides ?? ''} slides`.trim()],
    abstract: null,
    chips,
    date: d.live ? 'Live' : 'Evergreen',
    sortDate: '',
    href: d.href,
    pdfHref: d.pdfHref,
    isPublished: true,
    access: d.access,
  };
}

// ---------------------------------------------------------------- filters

export interface ReportKindFilter {
  key: string;
  label: string;
  match: (c: ReportCard) => boolean;
}

export const REPORT_KIND_FILTERS: ReportKindFilter[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'claim', label: 'Claim', match: (c) => c.kind === 'claim' },
  { key: 'bridge', label: 'Bridge', match: (c) => c.kind === 'bridge' },
  { key: 'lens', label: 'Lens', match: (c) => c.kind === 'lens' },
  { key: 'atlas', label: 'Executive briefing', match: (c) => c.kind === 'atlas' },
  { key: 'roundup', label: 'Research roundup', match: (c) => c.kind === 'roundup' },
  { key: 'edition', label: 'Edition', match: (c) => c.kind === 'edition' },
  { key: 'intel_deck', label: 'Intel deck', match: (c) => c.kind === 'intel_deck' },
  { key: 'tooling', label: 'Tooling', match: (c) => c.kind.startsWith('tooling_') },
  { key: 'period', label: 'Period', match: (c) => c.kind === 'period' },
  { key: 'thesis', label: 'Thesis', match: (c) => c.kind === 'thesis' },
  { key: 'deck', label: 'Decks', match: (c) => c.family === 'deck' },
];

export const DRAFTS_FILTER: ReportKindFilter = {
  key: 'drafts',
  label: 'Drafts',
  match: (c) => !c.isPublished,
};

export function filterCards(
  cards: ReportCard[],
  { q, kind, admin }: { q: string; kind: string; admin: boolean }
): ReportCard[] {
  let out = cards;
  const kindFilter =
    kind === 'drafts'
      ? (admin ? DRAFTS_FILTER : undefined)
      : REPORT_KIND_FILTERS.find((f) => f.key === kind);
  if (kindFilter && kindFilter.key !== 'all') {
    out = out.filter(kindFilter.match);
  }
  const term = q.trim().toLowerCase();
  if (term) {
    out = out.filter((c) => {
      const hay = [c.title, c.subject ?? '', c.kindLabel, c.abstract ?? '', c.chips.join(' '), c.metaLines.join(' ')]
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }
  return out;
}

// ---------------------------------------------------------------- pagination

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (clamped - 1) * size;
  return { items: items.slice(start, start + size), page: clamped, pages, total };
}

// ---------------------------------------------------------------- sort

// Dated reports newest first; undated cards (sortDate '', the decks) after
// all of them, in registry order (a stable sort keeps their input order).
export function sortCards(cards: ReportCard[]): ReportCard[] {
  return [...cards].sort((a, b) => {
    if (!a.sortDate && !b.sortDate) return 0;
    if (!a.sortDate) return 1;
    if (!b.sortDate) return -1;
    if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
}

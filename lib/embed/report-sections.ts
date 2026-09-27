// The Atlas's own editorial reports, cut into citable sections (2026-09-27).
// Pure, zero imports: loaded by lib/embed/sources.ts (the embedding corpus),
// lib/ask/retrieve.ts and lib/ask/search.ts (a hit rebuilt into its one
// passage), scripts/backfill-embeddings.mjs and scripts/test-report-sections.mjs.
//
// Three kinds enter Ask: the Daily Edition (one section per front story, and
// the column), the Friday research roundup (reading, connections, watch,
// bottom line) and Savant (the summary, the lead, the hypotheses, and one
// section per department). Savant's peer and market watch is portalOnly: it
// names the reader organization's peers, so only keyholders and the admin
// ever retrieve it. The editor's note is not editorial content and stays out.
// A section's record id is '<report uuid>:<section key>'.

export type ReportKind = 'edition' | 'roundup' | 'savant';
export const REPORT_KINDS: ReportKind[] = ['edition', 'roundup', 'savant'];

// Editions are a rolling window: a daily front from months ago should not
// outrank a standing record. Roundups and Savant issues stay.
export const EDITION_WINDOW_DAYS = 90;

export interface ReportSection { key: string; label: string; text: string; portalOnly: boolean }

export interface ReportRow {
  id: string;
  kind: string;
  scope_to: string | null;
  title: string;
  narrative: unknown;
}

const strip = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SAVANT_DEPT_LABEL: Record<string, string> = {
  moved: 'What moved', peers: 'Peer and market watch', regulation: 'Regulation and policy',
  research: 'Research desk', tools: 'Tools and builders', missed: 'Missed and blind spots', ahead: 'The week ahead',
};

export function reportSections(row: ReportRow): ReportSection[] {
  const n = obj(row.narrative);
  const out: ReportSection[] = [];
  const add = (key: string, label: string, text: string, portalOnly = false) => {
    const t = text.trim();
    if (t.length >= 40) out.push({ key, label, text: t, portalOnly });
  };
  if (row.kind === 'edition') {
    arr(n.front).forEach((f, i) => {
      const x = obj(f);
      add(`front-${i}`, i === 0 ? 'Front page, top story' : `Front page, story ${i + 1}`,
        [strip(x.headline), strip(x.why), strip(x.numbers)].filter(Boolean).join(' '));
    });
    const col = obj(n.column);
    add('column', 'The column', [strip(col.title), strip(col.html)].filter(Boolean).join('. '));
  } else if (row.kind === 'roundup') {
    add('reading', 'The reading', strip(n.reading));
    add('connections', 'Connections', strip(n.connections));
    add('watch', 'What to watch', strip(n.watch));
    add('bottomLine', 'Bottom line', strip(n.bottomLine));
  } else if (row.kind === 'savant') {
    add('summary', 'Executive summary', arr(n.summary).map(strip).filter(Boolean).join(' '));
    const lead = obj(n.lead);
    add('lead', 'Lead analysis', [strip(lead.title), strip(lead.html)].filter(Boolean).join('. '));
    const hyp = obj(n.hypotheses);
    const fresh = obj(hyp.fresh);
    const readings = arr(hyp.readings).map((r) => {
      const x = obj(r);
      return [strip(x.statement), x.direction ? `(${String(x.direction)})` : '', strip(x.html)].filter(Boolean).join(' ');
    });
    add('hypotheses', "Savant's hypotheses", [strip(fresh.statement), strip(fresh.html), ...readings].filter(Boolean).join(' '));
    for (const d of arr(n.departments)) {
      const x = obj(d);
      const key = typeof x.key === 'string' ? x.key : '';
      if (!key || x.empty === true) continue;
      add(key, SAVANT_DEPT_LABEL[key] ?? (typeof x.title === 'string' ? x.title : key), strip(x.html), key === 'peers');
    }
  }
  return out;
}

const KIND_NAME: Record<ReportKind, string> = { edition: 'Daily edition', roundup: 'Research roundup', savant: 'Savant' };

// The chunk title every chunk of a section carries: which report, which
// week or day, which section. It is what the reader of a retrieved passage
// needs to know first.
export function reportPrefix(kind: string, scope: string | null, label: string): string {
  const name = KIND_NAME[kind as ReportKind] ?? 'Report';
  const when = !scope ? '' : kind === 'edition' ? `, ${scope}` : `, week ending ${scope}`;
  return `${name}${when}, ${label}`;
}

// The page (and anchor) a section lives at.
export function reportSectionHref(kind: string, id: string, scope: string | null, key: string): string {
  if (kind === 'edition' && scope) return `/blotter/${scope}#${key}`;
  if (kind === 'savant' && scope) return `/savant/${scope}#${key}`;
  return `/reports/sheet/${id}#${key}`;
}

export const REPORT_RECORD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9-]{1,24}$/;

export function splitReportRecordId(recordId: string): { id: string; key: string } | null {
  if (!REPORT_RECORD_RE.test(recordId)) return null;
  const i = recordId.indexOf(':');
  return { id: recordId.slice(0, i), key: recordId.slice(i + 1) };
}

// A guest-facing copy of a passage: every sentence naming an intel-registry
// company is dropped. Names come from the caller (the registry), longest
// first so "Harbor Trust Financial" wins over "Harbor Trust"; word boundaries,
// case-insensitive; names under three characters are ignored.
export function buildNameMatcher(names: string[]): RegExp | null {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  if (!clean.length) return null;
  return new RegExp(`(^|[^A-Za-z0-9])(${clean.join('|')})(?=$|[^A-Za-z0-9])`, 'i');
}

export function scrubSentences(text: string, re: RegExp | null): { text: string; removed: number } {
  if (!re) return { text, removed: 0 };
  // A sentence ends at . ! ? after a lowercase letter, digit or closing mark
  // and before a capital, digit or opening mark: "U.S. Bank" is not a break.
  const sentences = text.split(/(?<=[a-z0-9)\]"'\u201d%][.!?])\s+(?=[A-Z0-9"\u201c(])/);
  const kept = sentences.filter((s) => !re.test(s));
  return { text: kept.join(' ').trim(), removed: sentences.length - kept.length };
}

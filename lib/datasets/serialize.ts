import type { DatasetDef, DatasetRow } from './core';

// Server-side dataset serializers. A superset of lib/viewdata.ts's rules
// (RFC-4180-ish quoting, CRLF rows) that additionally admits null cells
// (rendered as an empty field) and uses each column's machine KEY as the CSV
// header rather than its display label: keys are stable snake_case identifiers,
// which is what SQL engines, pandas, and DuckDB want. Column labels and defs
// travel in the JSON envelope and the `catalog` dataset instead.

function csvField(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function datasetToCSV(def: DatasetDef, rows: DatasetRow[]): string {
  const head = def.columns.map((c) => csvField(c.key)).join(',');
  const body = rows.map((r) =>
    def.columns.map((c) => csvField(r[c.key] ?? null)).join(',')
  );
  return [head, ...body].join('\r\n');
}

// The JSON envelope carries the schema alongside the rows so a consumer never
// needs a second request to interpret a download.
export function datasetToJSON(
  def: DatasetDef, rows: DatasetRow[],
  opts: { lens?: string; day?: string; since?: string; source?: string; preview?: boolean } = {}
): string {
  return JSON.stringify({
    dataset: {
      slug: def.slug,
      title: def.title,
      description: def.description,
      methodology: def.methodology,
      category: def.category,
      lens: opts.lens ?? null,
      day: opts.day ?? null,
      since: opts.since ?? null,
      source: opts.source ?? null,
      row_count: rows.length,
      columns: def.columns,
      ...(opts.preview ? { preview: true } : {}),
    },
    rows,
  });
}

// Safe filename stem, mirroring lib/viewdata.ts fileStem.
// Every download filename carries a date so a folder of firewall pulls sorts
// and dedupes by itself: the served day for day-filtered datasets, the since
// date for incremental pulls, and otherwise the UTC date the file was
// generated (signals-export, intel-facts, and the other whole-corpus sets).
export function datasetFileName(
  def: DatasetDef, format: 'csv' | 'json', lens?: string, day?: string, since?: string
): string {
  const date = day || since || new Date().toISOString().slice(0, 10);
  const stem = ['atlas', def.slug, lens, date].filter(Boolean).join('-');
  return `${stem}.${format}`;
}

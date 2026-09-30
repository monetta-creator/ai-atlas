import type { DatasetColumn, DatasetDef, DatasetRow } from './core';
import type { FilterSpec } from './filter';

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

// `opts.columns`, when given, is the filter grammar's projected column list
// (lib/datasets/filter.ts projectColumns): a subset of def.columns, in the
// requested order. Defaults to every column, unchanged from before the
// filter grammar existed.
export function datasetToCSV(
  def: DatasetDef, rows: DatasetRow[], opts: { columns?: DatasetColumn[] } = {}
): string {
  const columns = opts.columns ?? def.columns;
  const head = columns.map((c) => csvField(c.key)).join(',');
  const body = rows.map((r) =>
    columns.map((c) => csvField(r[c.key] ?? null)).join(',')
  );
  return [head, ...body].join('\r\n');
}

// The JSON envelope carries the schema alongside the rows so a consumer never
// needs a second request to interpret a download. `columns` reflects a
// requested projection; `filter` is the normalized filter spec (null when
// nothing in the grammar was requested).
// A large body as a stream of slices: Vercel refuses a buffered function
// response over 4.5 MB, while a streamed body has no such cap.
export function streamString(body: string, slice = 256 * 1024): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= body.length) { controller.close(); return; }
      let end = Math.min(body.length, at + slice);
      // Never end a slice on a high surrogate: splitting a pair would encode
      // both halves as U+FFFD and corrupt the character.
      const last = body.charCodeAt(end - 1);
      if (end < body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      controller.enqueue(enc.encode(body.slice(at, end)));
      at = end;
    },
  });
}

export function streamBytes(body: Uint8Array, slice = 256 * 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= body.length) { controller.close(); return; }
      const end = Math.min(body.length, at + slice);
      controller.enqueue(body.subarray(at, end));
      at = end;
    },
  });
}

export function datasetToJSON(
  def: DatasetDef, rows: DatasetRow[],
  opts: {
    lens?: string; day?: string; since?: string; source?: string; preview?: boolean;
    columns?: DatasetColumn[]; filter?: FilterSpec | null;
  } = {}
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
      columns: opts.columns ?? def.columns,
      filter: opts.filter ?? null,
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
// The context pack's markdown documents: one company, one size, one day.
export function packFileName(company: string, size: string, asOf: string): string {
  return `atlas-context-${company}-${size}-${asOf}.md`;
}

export function datasetFileName(
  def: DatasetDef, format: 'csv' | 'json', lens?: string, day?: string, since?: string,
  filtered?: boolean
): string {
  const date = day || since || new Date().toISOString().slice(0, 10);
  const stem = ['atlas', def.slug, lens, date].filter(Boolean).join('-');
  return `${stem}${filtered ? '-filtered' : ''}.${format}`;
}

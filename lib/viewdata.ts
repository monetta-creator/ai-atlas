// Pure serializers for a ViewDataset → TSV / CSV / Markdown. Client-safe (no server imports):
// imported by the ViewData modal. Header row uses each column's `label`; cells read `row[col.key]`.
import type { ViewDataset } from './types';

const cells = (ds: ViewDataset, row: Record<string, string | number>) =>
  ds.columns.map((c) => row[c.key] ?? '');

// Tab-separated — pastes into Sheets/Slides with cells split. Values here are short labels/numbers;
// strip any stray tabs/newlines so the grid never skews.
export function toTSV(ds: ViewDataset): string {
  const clean = (v: string | number) => String(v).replace(/[\t\r\n]+/g, ' ');
  const head = ds.columns.map((c) => clean(c.label)).join('\t');
  const body = ds.rows.map((r) => cells(ds, r).map(clean).join('\t'));
  return [head, ...body].join('\n');
}

// RFC-4180-ish CSV: quote any field containing comma, quote, or newline; double embedded quotes.
export function toCSV(ds: ViewDataset): string {
  const q = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ds.columns.map((c) => q(c.label)).join(',');
  const body = ds.rows.map((r) => cells(ds, r).map(q).join(','));
  return [head, ...body].join('\r\n');
}

// GitHub-flavored Markdown table; escape pipes so cell content can't break the grid.
export function toMarkdown(ds: ViewDataset): string {
  const esc = (v: string | number) => String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const head = `| ${ds.columns.map((c) => esc(c.label)).join(' | ')} |`;
  const rule = `| ${ds.columns.map(() => '---').join(' | ')} |`;
  const body = ds.rows.map((r) => `| ${cells(ds, r).map(esc).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

// A safe filename stem from the dataset title, e.g. "Funnel composition · by lens" → "funnel-composition-by-lens".
export function fileStem(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
}

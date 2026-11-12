// The answer's Markdown block grammar (2026-11-12): the model writes a small
// Markdown subset and the renderer decides how each block looks. Import-free
// so scripts/test-md-blocks.mts loads it under tsx.
//
// Blocks: paragraph, heading (#..###), bullet list, numbered list, table
// (GFM: a header row, a |---| separator, body rows), rule (---). Inline
// formatting (citations, **bold**) is the renderer's job, per text segment.
// Anything else, raw HTML included, stays literal paragraph text.
//
// Streaming: a table only becomes a table once its separator row has
// arrived; before that its header shows as a plain line for a moment.

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[]; start: number }
  | { type: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { type: 'hr' };

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const RULE = /^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/;
const SEP_CELL = /^\s*:?-{1,}:?\s*$/;

export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isRowLine = (l: string) => l.includes('|') && l.trim().length > 1;

function separator(line: string): Align[] | null {
  if (!line.includes('-') || !line.includes('|')) {
    // A one-column table may omit pipes entirely; not supported (too ambiguous with rules).
    return null;
  }
  const cells = splitRow(line);
  if (!cells.length || !cells.every((c) => SEP_CELL.test(c))) return null;
  return cells.map((c) => {
    const t = c.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  });
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    const t = para.join('\n').trim();
    if (t) out.push({ type: 'p', text: t });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flush(); i++; continue; }

    // Table: a row line followed by a separator line.
    if (isRowLine(line) && i + 1 < lines.length) {
      const align = separator(lines[i + 1]);
      if (align) {
        flush();
        const head = splitRow(line);
        const width = Math.max(head.length, align.length);
        const pad = (r: string[]) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && isRowLine(lines[i])) {
          rows.push(pad(splitRow(lines[i])));
          i++;
        }
        const alignW: Align[] = Array.from({ length: width }, (_, k) => align[k] ?? null);
        out.push({ type: 'table', head: pad(head), align: alignW, rows });
        continue;
      }
    }

    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ type: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }

    if (RULE.test(line)) { flush(); out.push({ type: 'hr' }); i++; continue; }

    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flush();
      const ordered = Boolean(n);
      const items: string[] = [];
      const start = n ? Number(n[1]) : 1;
      while (i < lines.length) {
        const l = lines[i];
        const m = ordered ? NUMBERED.exec(l) : BULLET.exec(l);
        if (m) { items.push(ordered ? m[2] : m[1]); i++; continue; }
        // A continuation line (indented, not blank, not another block) joins the item.
        if (l.trim() && /^\s{2,}\S/.test(l) && items.length) { items[items.length - 1] += `\n${l.trim()}`; i++; continue; }
        break;
      }
      out.push(ordered ? { type: 'ol', items, start } : { type: 'ul', items });
      continue;
    }

    para.push(line);
    i++;
  }
  flush();
  return out;
}

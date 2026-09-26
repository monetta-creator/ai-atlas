// Savant's figures (2026-09-26): the graphic vocabulary Savant uses to tell
// its story, and the deterministic layout behind it. Savant never draws raw
// SVG. It emits a small spec per figure (which kind, which entities, which
// hrefs, what caption) and this module validates the spec against the
// issue's citation allow-list, then lays it out as a list of primitives.
// Two thin painters render the same primitives: inline SVG on the web
// (components/savant/Figure.tsx) and react-pdf Svg in the PDF
// (lib/pdf/savant-figures.tsx). Nothing here imports the DB or React, so
// scripts/test-savant-figures.mjs loads it under plain Node.
//
// Kinds:
//   entities  a card grid of named things (favicon, name, one line, bullets)
//   map       a two-axis placement of entities: Savant's judgment, labeled so
//   relation  a node-and-edge diagram, nodes in labeled groups (columns)
//   timeline  dated events on one axis
//   compare   horizontal bars over numbers Savant took from cited records
//   steps     a left-to-right flow of labeled steps
//
// Every entity, event, bar and node that carries an href must carry one the
// allow-list holds (a pack record or an Atlas page); a figure that names an
// unknown href is dropped whole, the way the citation gate drops a link.

export type FigureKind = 'entities' | 'map' | 'relation' | 'timeline' | 'compare' | 'steps';
export type FigureSection = 'lead' | 'moved' | 'peers' | 'regulation' | 'research' | 'tools' | 'missed' | 'ahead';

export interface FigureEntity {
  label: string;
  href: string | null;
  domain: string | null;      // favicon domain (derived from the href or the catalog), null = monogram
  note: string | null;        // one line under the name
  bullets: string[];          // up to 3
  logo?: string | null;       // PNG data URI baked at run time for the PDF; absent on the web path
}

export interface FigureBase {
  id: string;
  section: FigureSection;
  after: number;              // insert after this block of the section's html; -1 = at the end
  title: string;
  caption: string;            // one sentence under the figure: the reading Savant wants taken
}
export interface EntitiesFigure extends FigureBase { kind: 'entities'; entities: FigureEntity[]; columns: 2 | 3 }
export interface MapFigure extends FigureBase {
  kind: 'map';
  x: { label: string; low: string; high: string };
  y: { label: string; low: string; high: string };
  points: { entity: FigureEntity; x: number; y: number }[];   // 0..1 each
}
export interface RelationFigure extends FigureBase {
  kind: 'relation';
  nodes: { id: string; label: string; href: string | null; group: string | null }[];
  edges: { from: string; to: string; label: string | null }[];
}
export interface TimelineFigure extends FigureBase { kind: 'timeline'; events: { date: string; label: string; href: string | null }[] }
export interface CompareFigure extends FigureBase { kind: 'compare'; unit: string; bars: { label: string; value: number; href: string | null }[] }
export interface StepsFigure extends FigureBase { kind: 'steps'; steps: { label: string; note: string | null }[] }
export type SavantFigure = EntitiesFigure | MapFigure | RelationFigure | TimelineFigure | CompareFigure | StepsFigure;

export const FIGURE_SECTIONS: FigureSection[] = ['lead', 'moved', 'peers', 'regulation', 'research', 'tools', 'missed', 'ahead'];
export const MAX_FIGURES_PER_ISSUE = 6;
export const MAX_FIGURES_PER_SECTION = 2;

// ---------------------------------------------------------------- validation

export interface FigureCatalogEntry { href: string; domain: string | null; label: string }

export interface ValidateResult { figures: SavantFigure[]; dropped: string[] }

const clip = (s: unknown, n: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num01 = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

export function domainOf(href: string | null): string | null {
  if (!href) return null;
  try {
    if (!/^https?:\/\//.test(href)) return null;
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

function entityFrom(raw: unknown, allowed: Set<string>, catalog: Map<string, FigureCatalogEntry>): FigureEntity | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const label = clip(r.label, 60);
  if (!label) return null;
  const href = typeof r.href === 'string' && r.href.trim() ? r.href.trim() : null;
  if (href && !allowed.has(href)) return null;
  const cat = href ? catalog.get(href) : undefined;
  const bullets = Array.isArray(r.bullets) ? r.bullets.map((b) => clip(b, 110)).filter(Boolean).slice(0, 3) : [];
  return { label, href, domain: cat?.domain ?? domainOf(href), note: clip(r.note, 110) || null, bullets };
}

// Validates the model's raw figure specs. `allowed` is the issue's citation
// allow-list (every href the gate would keep); `catalog` maps an href to the
// favicon domain the pack knows for it. Returns the surviving figures in
// section order with a one-line reason for each dropped one.
export function validateFigures(
  raw: unknown,
  allowed: Set<string>,
  catalog: Map<string, FigureCatalogEntry> = new Map(),
  banned: RegExp | null = null
): ValidateResult {
  const dropped: string[] = [];
  const out: SavantFigure[] = [];
  const perSection = new Map<string, number>();
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i += 1) {
    const r = (list[i] ?? {}) as Record<string, unknown>;
    const kind = r.kind as FigureKind;
    const section = r.section as FigureSection;
    const title = clip(r.title, 90);
    const caption = clip(r.caption, 240);
    const where = `figure ${i + 1} (${typeof kind === 'string' ? kind : 'unknown'})`;
    if (!FIGURE_SECTIONS.includes(section)) { dropped.push(`${where}: unknown section`); continue; }
    if (!title) { dropped.push(`${where}: no title`); continue; }
    if (banned && (banned.test(title) || banned.test(caption))) { dropped.push(`${where}: banned words in title or caption`); continue; }
    if (out.length >= MAX_FIGURES_PER_ISSUE) { dropped.push(`${where}: issue cap of ${MAX_FIGURES_PER_ISSUE} reached`); continue; }
    if ((perSection.get(section) ?? 0) >= MAX_FIGURES_PER_SECTION) { dropped.push(`${where}: ${section} already has ${MAX_FIGURES_PER_SECTION}`); continue; }
    const base: FigureBase = {
      id: `fig-${out.length + 1}`, section, title, caption,
      after: typeof r.after === 'number' && Number.isInteger(r.after) && r.after >= -1 ? r.after : -1,
    };
    let fig: SavantFigure | null = null;
    let reason = '';
    switch (kind) {
      case 'entities': {
        const entities = (Array.isArray(r.entities) ? r.entities : []).map((e) => entityFrom(e, allowed, catalog));
        const bad = entities.filter((e) => e === null).length;
        const ok = entities.filter((e): e is FigureEntity => e !== null).slice(0, 9);
        if (bad) reason = `${bad} entit${bad === 1 ? 'y names' : 'ies name'} an href outside the issue's evidence`;
        else if (ok.length < 2) reason = 'fewer than 2 entities';
        else fig = { ...base, kind, entities: ok, columns: ok.length >= 5 ? 3 : 2 };
        break;
      }
      case 'map': {
        const ax = (v: unknown) => {
          const a = (v ?? {}) as Record<string, unknown>;
          return { label: clip(a.label, 50), low: clip(a.low, 30), high: clip(a.high, 30) };
        };
        const x = ax(r.x); const y = ax(r.y);
        const pts = (Array.isArray(r.points) ? r.points : []).map((p) => {
          const q = (p ?? {}) as Record<string, unknown>;
          const entity = entityFrom(q.entity ?? q, allowed, catalog);
          const px = num01(q.x); const py = num01(q.y);
          return entity && px !== null && py !== null ? { entity, x: px, y: py } : null;
        });
        const bad = pts.filter((p) => p === null).length;
        const ok = pts.filter((p): p is NonNullable<typeof p> => p !== null).slice(0, 10);
        if (!x.label || !y.label) reason = 'axes need labels';
        else if (bad) reason = `${bad} point(s) name an href outside the issue's evidence or lack coordinates`;
        else if (ok.length < 2) reason = 'fewer than 2 points';
        else fig = { ...base, kind, x, y, points: ok };
        break;
      }
      case 'relation': {
        const nodes = (Array.isArray(r.nodes) ? r.nodes : []).map((n) => {
          const q = (n ?? {}) as Record<string, unknown>;
          const id = clip(q.id, 40); const label = clip(q.label, 48);
          const href = typeof q.href === 'string' && q.href.trim() ? q.href.trim() : null;
          if (!id || !label) return null;
          if (href && !allowed.has(href)) return 'bad-href' as const;
          return { id, label, href, group: clip(q.group, 30) || null };
        });
        if (nodes.some((n) => n === 'bad-href')) { reason = 'a node names an href outside the issue\'s evidence'; break; }
        const okNodes = nodes.filter((n): n is Exclude<typeof n, null | 'bad-href'> => n !== null && n !== 'bad-href').slice(0, 12);
        const ids = new Set(okNodes.map((n) => n.id));
        const edges = (Array.isArray(r.edges) ? r.edges : []).map((e) => {
          const q = (e ?? {}) as Record<string, unknown>;
          const from = clip(q.from, 40); const to = clip(q.to, 40);
          return ids.has(from) && ids.has(to) && from !== to ? { from, to, label: clip(q.label, 40) || null } : null;
        }).filter((e): e is NonNullable<typeof e> => e !== null).slice(0, 16);
        if (okNodes.length < 3) reason = 'fewer than 3 nodes';
        else if (edges.length < 2) reason = 'fewer than 2 edges between known nodes';
        else fig = { ...base, kind, nodes: okNodes, edges };
        break;
      }
      case 'timeline': {
        const events = (Array.isArray(r.events) ? r.events : []).map((e) => {
          const q = (e ?? {}) as Record<string, unknown>;
          const date = clip(q.date, 10); const label = clip(q.label, 70);
          const href = typeof q.href === 'string' && q.href.trim() ? q.href.trim() : null;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) return null;
          if (href && !allowed.has(href)) return 'bad-href' as const;
          return { date, label, href };
        });
        if (events.some((e) => e === 'bad-href')) { reason = 'an event names an href outside the issue\'s evidence'; break; }
        const ok = events.filter((e): e is Exclude<typeof e, null | 'bad-href'> => e !== null && e !== 'bad-href')
          .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
        if (ok.length < 3) reason = 'fewer than 3 dated events';
        else fig = { ...base, kind, events: ok };
        break;
      }
      case 'compare': {
        const bars = (Array.isArray(r.bars) ? r.bars : []).map((b) => {
          const q = (b ?? {}) as Record<string, unknown>;
          const label = clip(q.label, 48);
          const href = typeof q.href === 'string' && q.href.trim() ? q.href.trim() : null;
          if (!label || typeof q.value !== 'number' || !Number.isFinite(q.value)) return null;
          if (!href || !allowed.has(href)) return 'bad-href' as const;
          return { label, value: q.value, href };
        });
        if (bars.some((b) => b === 'bad-href')) { reason = 'every bar needs an href from the issue\'s evidence'; break; }
        const ok = bars.filter((b): b is Exclude<typeof b, null | 'bad-href'> => b !== null && b !== 'bad-href').slice(0, 8);
        if (ok.length < 2) reason = 'fewer than 2 bars';
        else fig = { ...base, kind, unit: clip(r.unit, 12).replace(/\s+\S*$/, (m) => (m.length > 3 ? '' : m)), bars: ok };
        break;
      }
      case 'steps': {
        const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => {
          const q = (s ?? {}) as Record<string, unknown>;
          const label = clip(q.label, 40);
          return label ? { label, note: clip(q.note, 90) || null } : null;
        }).filter((s): s is NonNullable<typeof s> => s !== null).slice(0, 6);
        if (steps.length < 3) reason = 'fewer than 3 steps';
        else fig = { ...base, kind, steps };
        break;
      }
      default:
        reason = 'unknown kind';
    }
    if (!fig) { dropped.push(`${where}: ${reason}`); continue; }
    out.push(fig);
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
  }
  return { figures: out, dropped };
}

// ---------------------------------------------------------------- html blocks

// Splits marked's flat output into top-level blocks so a figure can sit
// between paragraphs. Anything unrecognized stays attached to the block
// before it.
const BLOCK_RE = /<(p|ul|ol|blockquote|h[1-6]|pre|table)\b[\s\S]*?<\/\1>/gi;

export function splitBlocks(html: string | null): string[] {
  if (!html) return [];
  const out: string[] = [];
  let last = 0;
  for (const m of html.matchAll(BLOCK_RE)) {
    const start = m.index ?? 0;
    const between = html.slice(last, start).trim();
    if (between && out.length) out[out.length - 1] += between;
    else if (between) out.push(between);
    out.push(m[0]);
    last = start + m[0].length;
  }
  const tail = html.slice(last).trim();
  if (tail && out.length) out[out.length - 1] += tail;
  else if (tail) out.push(tail);
  return out;
}

// Places a section's figures between its blocks: [{html}] and [{figure}]
// in reading order. A figure whose `after` points past the end lands last.
export type SectionPiece = { html: string } | { figure: SavantFigure };

export function interleave(html: string | null, figures: SavantFigure[]): SectionPiece[] {
  const blocks = splitBlocks(html);
  const pieces: SectionPiece[] = [];
  const byAfter = new Map<number, SavantFigure[]>();
  for (const f of figures) {
    const at = f.after < 0 || f.after >= blocks.length ? blocks.length - 1 : f.after;
    byAfter.set(at, [...(byAfter.get(at) ?? []), f]);
  }
  if (!blocks.length) return figures.map((figure) => ({ figure }));
  blocks.forEach((b, i) => {
    pieces.push({ html: b });
    for (const f of byAfter.get(i) ?? []) pieces.push({ figure: f });
  });
  return pieces;
}

// ---------------------------------------------------------------- layout

export type Tone = 'ink' | 'cobalt' | 'cobaltSoft' | 'dim' | 'faint' | 'line' | 'paper' | 'none';
export type Prim =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: Tone; stroke?: Tone; r?: number; href?: string | null }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: Tone; stroke?: Tone; href?: string | null }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Tone; width?: number; dash?: boolean }
  | { t: 'path'; d: string; stroke: Tone; fill?: Tone; width?: number }
  | { t: 'text'; x: number; y: number; text: string; size: number; fill: Tone; anchor?: 'start' | 'middle' | 'end'; font?: 'body' | 'mono' | 'head'; bold?: boolean; href?: string | null };

export interface FigureLayout { width: number; height: number; prims: Prim[] }

export const FIG_W = 600;

// Rough text measure: Schibsted at size s averages ~0.52 em per character.
export const textWidth = (s: string, size: number): number => s.length * size * 0.52;

export function wrapText(s: string, maxChars: number, maxLines = 3): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur ? `${cur} ${w}` : w).length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[,.;:]$/, '').slice(0, Math.max(3, maxChars - 1))}…`;
    return kept;
  }
  return lines;
}

const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

function layoutTimeline(f: TimelineFigure): FigureLayout {
  const n = f.events.length;
  const padX = 40; const axisY = 96; const h = 190;
  const step = n > 1 ? (FIG_W - padX * 2) / (n - 1) : 0;
  const prims: Prim[] = [{ t: 'line', x1: padX - 10, y1: axisY, x2: FIG_W - padX + 10, y2: axisY, stroke: 'line', width: 1.5 }];
  f.events.forEach((e, i) => {
    const x = padX + step * i;
    const above = i % 2 === 0;
    const lines = wrapText(e.label, 22, 3);
    prims.push({ t: 'circle', cx: x, cy: axisY, r: 5, fill: 'cobalt', href: e.href });
    prims.push({ t: 'text', x, y: above ? axisY - 14 - lines.length * 12 - 4 : axisY + 22, text: shortDate(e.date).toUpperCase(), size: 8, fill: 'dim', anchor: 'middle', font: 'mono' });
    lines.forEach((ln, k) => {
      const y = above ? axisY - 12 - (lines.length - 1 - k) * 12 : axisY + 34 + k * 12;
      prims.push({ t: 'text', x, y, text: ln, size: 9.5, fill: 'ink', anchor: 'middle', href: e.href });
    });
  });
  return { width: FIG_W, height: h, prims };
}

function layoutCompare(f: CompareFigure): FigureLayout {
  const rowH = 26; const labelW = 170; const top = 10; const right = 70;
  const max = Math.max(...f.bars.map((b) => Math.abs(b.value)), 1e-9);
  const barW = FIG_W - labelW - right - 20;
  const prims: Prim[] = [];
  f.bars.forEach((b, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, (Math.abs(b.value) / max) * barW);
    prims.push({ t: 'text', x: labelW - 8, y: y + 16, text: wrapText(b.label, 30, 1)[0], size: 9.5, fill: 'ink', anchor: 'end', href: b.href });
    prims.push({ t: 'rect', x: labelW, y: y + 5, w, h: rowH - 10, fill: i === 0 ? 'cobalt' : 'cobaltSoft', href: b.href });
    const v = Math.abs(b.value) >= 100 ? Math.round(b.value).toLocaleString('en-US') : String(Math.round(b.value * 100) / 100);
    const valueText = `${b.value < 0 ? '-' : ''}${v}${f.unit ? ` ${f.unit}` : ''}`;
    const inside = w > textWidth(valueText, 9) * 1.15 + 16;
    prims.push(inside
      ? { t: 'text', x: labelW + w - 7, y: y + 16, text: valueText, size: 9, fill: i === 0 ? 'paper' : 'ink', anchor: 'end', font: 'mono', bold: true }
      : { t: 'text', x: labelW + w + 6, y: y + 16, text: valueText, size: 9, fill: 'dim', font: 'mono' });
  });
  return { width: FIG_W, height: top + f.bars.length * rowH + 6, prims };
}

function layoutSteps(f: StepsFigure): FigureLayout {
  const n = f.steps.length; const gap = 18; const pad = 10;
  const w = (FIG_W - pad * 2 - gap * (n - 1)) / n; const boxH = 46; const top = 8;
  const prims: Prim[] = [];
  let noteLines = 0;
  f.steps.forEach((s, i) => {
    const x = pad + i * (w + gap);
    prims.push({ t: 'rect', x, y: top, w, h: boxH, fill: i === 0 ? 'cobalt' : 'paper', stroke: i === 0 ? 'cobalt' : 'line', r: 3 });
    const lines = wrapText(s.label, Math.max(8, Math.floor(w / 5.6)), 2);
    lines.forEach((ln, k) => prims.push({ t: 'text', x: x + w / 2, y: top + boxH / 2 + (k - (lines.length - 1) / 2) * 12 + 4, text: ln, size: 9.5, fill: i === 0 ? 'paper' : 'ink', anchor: 'middle', bold: true }));
    if (i < n - 1) prims.push({ t: 'path', d: `M${x + w + 3} ${top + boxH / 2} l${gap - 6} 0 m-5 -4 l5 4 l-5 4`, stroke: 'dim', width: 1.2 });
    if (s.note) {
      const nl = wrapText(s.note, Math.max(10, Math.floor(w / 4.8)), 3);
      nl.forEach((ln, k) => prims.push({ t: 'text', x: x + w / 2, y: top + boxH + 16 + k * 11, text: ln, size: 8.5, fill: 'dim', anchor: 'middle' }));
      noteLines = Math.max(noteLines, nl.length);
    }
  });
  return { width: FIG_W, height: top + boxH + (noteLines ? 12 + noteLines * 11 : 0) + 8, prims };
}

function layoutMap(f: MapFigure): FigureLayout {
  const left = 60; const right = 20; const top = 16; const bottom = 56; const h = 340;
  const plotW = FIG_W - left - right; const plotH = h - top - bottom;
  const prims: Prim[] = [
    { t: 'rect', x: left, y: top, w: plotW, h: plotH, fill: 'none', stroke: 'line' },
    { t: 'line', x1: left + plotW / 2, y1: top, x2: left + plotW / 2, y2: top + plotH, stroke: 'line', dash: true },
    { t: 'line', x1: left, y1: top + plotH / 2, x2: left + plotW, y2: top + plotH / 2, stroke: 'line', dash: true },
    { t: 'text', x: left + plotW / 2, y: h - 30, text: f.x.label.toUpperCase(), size: 8, fill: 'dim', anchor: 'middle', font: 'mono' },
    { t: 'text', x: left, y: h - 16, text: f.x.low, size: 8.5, fill: 'faint', anchor: 'start' },
    { t: 'text', x: left + plotW, y: h - 16, text: f.x.high, size: 8.5, fill: 'faint', anchor: 'end' },
    { t: 'text', x: left - 8, y: top + 10, text: f.y.high, size: 8.5, fill: 'faint', anchor: 'end' },
    { t: 'text', x: left - 8, y: top + plotH - 2, text: f.y.low, size: 8.5, fill: 'faint', anchor: 'end' },
    { t: 'text', x: left - 8, y: top + plotH / 2 + 3, text: f.y.label.toUpperCase(), size: 8, fill: 'dim', anchor: 'end', font: 'mono' },
  ];
  // Labels nudge down when two points share a neighborhood.
  const placed: { x: number; y: number }[] = [];
  const pts = [...f.points].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of pts) {
    const cx = left + p.x * plotW; const cy = top + (1 - p.y) * plotH;
    let ly = cy + 4;
    for (const q of placed) if (Math.abs(q.x - cx) < 90 && Math.abs(q.y - ly) < 12) ly = q.y + 12;
    placed.push({ x: cx, y: ly });
    const anchor = p.x > 0.8 ? 'end' : 'start';
    const lx = anchor === 'end' ? cx - 9 : cx + 9;
    prims.push({ t: 'circle', cx, cy, r: 6, fill: 'cobalt', stroke: 'paper', href: p.entity.href });
    prims.push({ t: 'text', x: lx, y: ly, text: wrapText(p.entity.label, 26, 1)[0], size: 9.5, fill: 'ink', anchor, bold: true, href: p.entity.href });
  }
  return { width: FIG_W, height: h, prims };
}

function layoutRelation(f: RelationFigure): FigureLayout {
  const groups: string[] = [];
  for (const n of f.nodes) {
    const g = n.group ?? '';
    if (!groups.includes(g)) groups.push(g);
  }
  const cols = groups.length;
  const colW = (FIG_W - 20) / cols;
  const boxW = Math.min(150, Math.floor(colW * 0.6)); const boxH = 38; const rowGap = 14; const top = groups.some(Boolean) ? 30 : 10;
  const gapW = colW - boxW;                     // horizontal room between adjacent columns' boxes
  const labelChars = Math.max(6, Math.floor((gapW - 10) / 4.4));
  const pos = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  groups.forEach((g, ci) => {
    const members = f.nodes.filter((n) => (n.group ?? '') === g);
    maxRows = Math.max(maxRows, members.length);
    members.forEach((n, ri) => pos.set(n.id, { x: 10 + ci * colW + (colW - boxW) / 2, y: top + ri * (boxH + rowGap) }));
  });
  const prims: Prim[] = [];
  groups.forEach((g, ci) => {
    if (g) prims.push({ t: 'text', x: 10 + ci * colW + colW / 2, y: 14, text: g.toUpperCase(), size: 8, fill: 'dim', anchor: 'middle', font: 'mono' });
  });
  // Edges first, so boxes paint over them.
  for (const e of f.edges) {
    const a = pos.get(e.from); const b = pos.get(e.to);
    if (!a || !b) continue;
    const ax = a.x + boxW / 2; const ay = a.y + boxH / 2; const bx = b.x + boxW / 2; const by = b.y + boxH / 2;
    const sameCol = Math.abs(ax - bx) < 1;
    let sx = ax; let ex = bx;
    const sy = ay; const ey = by;
    if (sameCol) { sx = ax + boxW / 2; ex = bx + boxW / 2; }
    else if (bx > ax) { sx = ax + boxW / 2; ex = bx - boxW / 2; }
    else { sx = ax - boxW / 2; ex = bx + boxW / 2; }
    const mx = (sx + ex) / 2; const my = (sy + ey) / 2;
    const span = Math.round(Math.abs(bx - ax) / colW);   // columns crossed
    const bow = span > 1 ? boxH + rowGap : 0;             // a long edge dips under the columns it crosses
    const d = sameCol
      ? `M${sx} ${sy} C${sx + 40} ${sy}, ${ex + 40} ${ey}, ${ex} ${ey}`
      : `M${sx} ${sy} C${mx} ${sy + bow}, ${mx} ${ey + bow}, ${ex} ${ey}`;
    prims.push({ t: 'path', d, stroke: 'cobalt', width: 1.2 });
    prims.push({ t: 'circle', cx: ex, cy: ey, r: 2.5, fill: 'cobalt' });
    if (e.label) {
      const text = wrapText(e.label, span > 1 ? labelChars * 2 : labelChars, 1)[0];
      const lx = sameCol ? sx + 44 : mx; const ly = sameCol ? my : my + bow * 0.75 - 4;
      const tw = textWidth(text, 8) + 8;
      prims.push({ t: 'rect', x: lx - tw / 2, y: ly - 8, w: tw, h: 12, fill: 'paper' });
      prims.push({ t: 'text', x: lx, y: ly + 1, text, size: 8, fill: 'dim', anchor: 'middle' });
    }
  }
  for (const n of f.nodes) {
    const p = pos.get(n.id)!;
    prims.push({ t: 'rect', x: p.x, y: p.y, w: boxW, h: boxH, fill: 'paper', stroke: n.href ? 'cobalt' : 'line', r: 3, href: n.href });
    const lines = wrapText(n.label, Math.max(10, Math.floor(boxW / 5.4)), 2);
    lines.forEach((ln, k) => prims.push({ t: 'text', x: p.x + boxW / 2, y: p.y + boxH / 2 + (k - (lines.length - 1) / 2) * 11 + 4, text: ln, size: 9, fill: 'ink', anchor: 'middle', bold: true, href: n.href }));
  }
  return { width: FIG_W, height: top + maxRows * (boxH + rowGap) - rowGap + 10, prims };
}

// Entities lay out as cards, not primitives (the painters own the card
// chrome: favicon image, name, note, bullets), so this returns null for them.
export function layoutFigure(f: SavantFigure): FigureLayout | null {
  switch (f.kind) {
    case 'timeline': return layoutTimeline(f);
    case 'compare': return layoutCompare(f);
    case 'steps': return layoutSteps(f);
    case 'map': return layoutMap(f);
    case 'relation': return layoutRelation(f);
    default: return null;
  }
}

// The note every map carries: the placement is Savant's judgment.
export const MAP_NOTE = "Savant's placement, a reading of the linked records, not a measurement.";

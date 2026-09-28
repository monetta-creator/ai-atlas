// The Field Report cover's topographic motif: a handful of irregular,
// concentric contour lines, deterministic from the report's id, the way a
// hill reads on a topo map. Zero imports (like core.ts) so both the web view
// (components/field-report/FieldReportView.tsx, inline SVG) and the PDF
// (lib/pdf/field-report-doc.tsx, react-pdf Svg) draw the exact same lines
// from the exact same call: one <path d> per ring, painted by each host in
// whatever element that host's renderer needs.

export interface ContourLine {
  d: string;
  ring: number;   // 0 = outermost
}

// FNV-1a over the seed text, so two different report ids reliably land on
// different landforms without pulling in a hashing dependency.
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: a tiny deterministic PRNG, seeded once per report.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed, rounded path through `points`: for each point, quadratic-curve
// from the midpoint before it to the midpoint after it, using the point
// itself as the control. Cheap and dependency-free, and reads as a smooth
// hand-drawn loop rather than a faceted polygon.
function smoothClosedPath(points: { x: number; y: number }[]): string {
  if (points.length < 3) return '';
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = mid(points[points.length - 1], points[0]);
  let d = `M${first.x.toFixed(2)} ${first.y.toFixed(2)} `;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const next = points[(i + 1) % points.length];
    const m = mid(p, next);
    d += `Q${p.x.toFixed(2)} ${p.y.toFixed(2)} ${m.x.toFixed(2)} ${m.y.toFixed(2)} `;
  }
  return `${d}Z`;
}

// 6-9 nested, irregular loops around (cx, cy), sharing a few random "bumps"
// (in angle) so the rings read as one landform rather than unrelated blobs,
// each ring's own light wobble and radius so no two rings, and no two report
// ids, draw the same shape.
export function contourLines(
  seedText: string,
  opts: { cx?: number; cy?: number; maxR?: number; count?: number } = {}
): ContourLine[] {
  const cx = opts.cx ?? 300;
  const cy = opts.cy ?? 300;
  const maxR = opts.maxR ?? 260;
  const rand = mulberry32(hashSeed(seedText || 'field-report'));
  const count = opts.count ?? 6 + Math.floor(rand() * 4); // 6..9
  const angleSteps = 16;
  const bumps = Array.from({ length: 4 }, () => ({
    angle: rand() * Math.PI * 2,
    strength: 0.1 + rand() * 0.16,
    width: 0.55 + rand() * 0.85,
  }));
  const lines: ContourLine[] = [];
  for (let ring = 0; ring < count; ring += 1) {
    const r = maxR * (1 - ring / count) * (0.92 + rand() * 0.08);
    const phase = rand() * Math.PI * 2;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < angleSteps; i += 1) {
      const a = (i / angleSteps) * Math.PI * 2;
      let bump = 0;
      for (const b of bumps) {
        const diff = Math.atan2(Math.sin(a - b.angle), Math.cos(a - b.angle));
        bump += b.strength * Math.exp(-(diff * diff) / (2 * b.width * b.width));
      }
      const wobble = 0.05 * Math.sin(a * 5 + phase + ring * 0.7);
      const rr = r * (1 + bump + wobble);
      points.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
    }
    lines.push({ d: smoothClosedPath(points), ring });
  }
  return lines;
}

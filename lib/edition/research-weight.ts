// The research section's quiet importance signal (2026-09-26). PLAIN-NODE
// LOADABLE, no imports. A paper's weight is three marks a reader can scan:
// a human confirmed it (tracked or noted), it reaches the argument map (bears
// on a position or sits on a thread), and the model-proposed rigor is high.
// The kicker spells the marks out in a mono line. Guest-safe by construction:
// the rigor BAND of the model's proposed score, never the number and never
// the maintainer's own rigor_prior (personal layer).

export type RigorBand = 'high' | 'medium' | 'low';

export interface PaperWeightInput {
  reviewStatus: string | null;      // pending | tracked | noted | dismissed
  claimTouches: number;             // positions the paper bears on
  threadRelations: string[];        // confirmed thread relations: supports | complicates | contradicts | context
  proposedRigor: number | null;     // extraction.proposed_rigor, 0..100
}

export interface PaperWeight {
  marks: 0 | 1 | 2 | 3;
  confirmed: boolean;
  reach: number;
  rigorBand: RigorBand | null;
  contradicts: boolean;
  kicker: string;                   // "TRACKED · BEARS ON 2 · RIGOR HIGH", '' when nothing applies
}

// Bands measured 2026-09-26 over 682 kept papers from 30 days of
// proposed_rigor: median 62, first quartile 55, top decile from 72, and 21%
// at 70 or more. High is therefore the top fifth, medium the middle half,
// low the bottom quarter; a band that most papers reach would say nothing.
export function rigorBandOf(score: number | null | undefined): RigorBand | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 70) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

export function paperWeight(i: PaperWeightInput): PaperWeight {
  const confirmed = i.reviewStatus === 'tracked' || i.reviewStatus === 'noted';
  const touches = Math.max(0, Math.floor(i.claimTouches || 0));
  const onThread = i.threadRelations.length > 0;
  const reach = touches + (onThread ? 1 : 0);
  const rigorBand = rigorBandOf(i.proposedRigor);
  const contradicts = i.threadRelations.some((r) => r === 'contradicts');
  const marks = ((confirmed ? 1 : 0) + (reach > 0 ? 1 : 0) + (rigorBand === 'high' ? 1 : 0)) as 0 | 1 | 2 | 3;

  const parts: string[] = [];
  if (confirmed) parts.push(i.reviewStatus === 'noted' ? 'NOTED' : 'TRACKED');
  if (touches > 0) parts.push(`BEARS ON ${touches}`);
  else if (onThread) parts.push('ON A THREAD');
  if (rigorBand) parts.push(`RIGOR ${rigorBand.toUpperCase()}`);
  if (contradicts) parts.push('CONTRADICTS');

  return { marks, confirmed, reach, rigorBand, contradicts, kicker: parts.join(' · ') };
}

// Heaviest first, then human-confirmed first, then the caller's order (the
// pack loads newest first), stable.
export function sortPapersByWeight<T extends { weight?: PaperWeight }>(papers: T[]): T[] {
  return papers
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const wa = a.p.weight; const wb = b.p.weight;
      const ma = wa?.marks ?? 0; const mb = wb?.marks ?? 0;
      if (mb !== ma) return mb - ma;
      const ca = wa?.confirmed ? 1 : 0; const cb = wb?.confirmed ? 1 : 0;
      if (cb !== ca) return cb - ca;
      return a.i - b.i;
    })
    .map((x) => x.p);
}

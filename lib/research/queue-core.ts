// Pure rules for the research review desk (/research/queue). Import-free so
// scripts/test-research-queue.mjs loads it under plain Node.

export const QUEUE_DEFAULTS = {
  autoDismiss: true,
  minConfidence: 80,
  staleDays: 21,
} as const;

// The auto-dismiss bar may only sit inside this range (the 0082 CHECK).
export const MIN_CONFIDENCE_FLOOR = 50;
export const MIN_CONFIDENCE_CEIL = 100;
export const STALE_DAYS_MIN = 3;
export const STALE_DAYS_MAX = 180;

// Human paper-by-paper calls on papers the agent said to dismiss, bucketed by
// the agent's confidence rounded down to a multiple of 10.
export interface DismissBand {
  floor: number;   // 0, 10, ... 90 (100 folds into 90)
  n: number;       // human decisions in the band
  agreed: number;  // of those, how many the human also dismissed
}

export interface ThresholdSuggestion {
  threshold: number;
  n: number;
  agreed: number;
  rate: number;    // agreed / n, 0..1
}

// The lowest bar (a band floor, never under MIN_CONFIDENCE_FLOOR) at which
// the human agreed with the agent's dismissals at least `minRate` of the time
// across every decision at or above it, with at least `minN` decisions behind
// the number. The bar's own band needs `minBandN` decisions too: a bar at 60
// with nothing decided in the 60s would clear papers no human ever checked.
// null when the record is too thin or too disagreeable anywhere.
export function suggestThreshold(
  bands: DismissBand[],
  opts: { minN?: number; minRate?: number; minBandN?: number } = {}
): ThresholdSuggestion | null {
  const minN = opts.minN ?? 20;
  const minRate = opts.minRate ?? 0.95;
  const minBandN = opts.minBandN ?? 5;
  for (let t = MIN_CONFIDENCE_FLOOR; t <= 90; t += 10) {
    let n = 0;
    let agreed = 0;
    let own = 0;
    for (const b of bands) {
      const floor = Math.min(90, b.floor);
      if (floor >= t) {
        n += b.n;
        agreed += b.agreed;
      }
      if (floor === t) own += b.n;
    }
    if (own >= minBandN && n >= minN && agreed / n >= minRate) {
      return { threshold: t, n, agreed, rate: agreed / n };
    }
  }
  return null;
}

export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return QUEUE_DEFAULTS.minConfidence;
  return Math.max(MIN_CONFIDENCE_FLOOR, Math.min(MIN_CONFIDENCE_CEIL, Math.round(v)));
}

export function clampStaleDays(v: number): number {
  if (!Number.isFinite(v)) return QUEUE_DEFAULTS.staleDays;
  return Math.max(STALE_DAYS_MIN, Math.min(STALE_DAYS_MAX, Math.round(v)));
}

// The track why the sprint prefills: the agent's reason only when the agent
// itself recommended tracking (a dismissal's reason argues the other way).
export function prefillWhy(rec: string | null, reason: string | null): string {
  return rec === 'tracked' && reason ? reason.trim() : '';
}

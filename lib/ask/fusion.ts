// Pure reciprocal rank fusion, zero imports (loaded directly by
// scripts/test-embed.mjs under plain Node type stripping, and by
// lib/ask/retrieve.ts's hybrid leg). Standard RRF: each ranked list
// contributes 1 / (k + rank) per key it contains (rank is 1-based, best
// first); scores from every list sum per key. k = 60 is the usual default
// (Cormack et al.) — large enough that a key's exact rank inside one list
// matters less than simply appearing near the top of several.

export const RRF_K = 60;

export function reciprocalRankFusion(lists: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((key, idx) => {
      const rank = idx + 1;
      const s = 1 / (k + rank);
      scores.set(key, (scores.get(key) ?? 0) + s);
    });
  }
  return scores;
}

// The fused key order, best first. Ties keep the order the Map iteration
// produced (first-list-first), which is stable and good enough here: a true
// tie between two records is rare with floating-point RRF scores.
export function fuseOrder(lists: string[][], k: number = RRF_K): string[] {
  return [...reciprocalRankFusion(lists, k).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

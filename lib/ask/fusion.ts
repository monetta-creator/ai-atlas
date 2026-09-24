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
//
// FTS guard (2026-09-24, the p05 regression): lists[0] is always the FTS
// leg's own order (lib/ask/retrieve.ts calls fuseOrder([ftsKeyOrder,
// vecKeyOrder])). An exact lexical hit on a code or title is the strongest
// evidence retrieval has, so a broad question's cosine noise must never bury
// it: bridge B4, an FTS direct hit, was pushed past rank 10 by vector-only
// hits under plain RRF. After fusing, the FTS leg's top 3 keys are
// guaranteed a spot in the fused top 10 (pulled up to positions 8-10,
// 1-indexed, at the latest) if RRF would otherwise have dropped them out.
export function fuseOrder(lists: string[][], k: number = RRF_K): string[] {
  const fused = [...reciprocalRankFusion(lists, k).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  return guaranteeFtsTop3(fused, lists[0] ?? []);
}

function guaranteeFtsTop3(fused: string[], ftsOrder: string[]): string[] {
  const top3 = ftsOrder.slice(0, 3);
  if (!top3.length) return fused;
  const result = [...fused];
  top3.forEach((key, i) => {
    const guaranteedIdx = 7 + i; // 0-indexed 7,8,9 -> positions 8,9,10
    const curIdx = result.indexOf(key);
    if (curIdx === -1 || curIdx <= guaranteedIdx) return; // absent, or already within guarantee
    result.splice(curIdx, 1);
    result.splice(Math.min(guaranteedIdx, result.length), 0, key);
  });
  return result;
}

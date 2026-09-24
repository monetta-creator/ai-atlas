// Pure budget-gate logic for the embedding pipeline's daily spend cap, split
// out of lib/embed/hooks.ts (which pulls ../db and cannot load under plain
// Node type stripping) so scripts/test-embed.mjs can exercise the gate
// directly. Zero imports, like lib/embed/chunk.ts.

export function embedBudgetAllows(spentUsd: number, capUsd: number): boolean {
  return spentUsd < capUsd;
}

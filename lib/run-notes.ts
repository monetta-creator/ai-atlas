// Fold an invocation's notes into a run's persisted notes: first-occurrence
// order, identical strings counted instead of dropped ("<note> (x3)"), capped.
// Pure, no imports: shared by the four engines' run-note writers
// (appendScanRunNotes / appendIntelRunNotes / appendPipelineRunNotes /
// appendResearchRunNotes), each of which reads the row, folds, and writes back
// inside a transaction.

const SUFFIX_RE = / \(x(\d+)\)$/;
const BASE_MAX = 290;

// Split a PERSISTED entry into its base text and fold count. Only a trailing
// " (xN)" suffix (our own render shape) counts as a fold marker; an incoming
// note that happens to end the same way is never parsed this way (see below).
function parseExisting(entry: string): { base: string; count: number } {
  const m = entry.match(SUFFIX_RE);
  if (!m) return { base: entry.slice(0, BASE_MAX), count: 1 };
  return { base: entry.slice(0, entry.length - m[0].length).slice(0, BASE_MAX), count: Number(m[1]) || 1 };
}

export function foldRunNotes(existing: readonly string[], incoming: readonly string[], cap = 40): string[] {
  const order: string[] = [];
  const counts = new Map<string, number>();

  const bump = (base: string, by: number) => {
    if (!counts.has(base)) order.push(base);
    counts.set(base, (counts.get(base) ?? 0) + by);
  };

  for (const entry of existing) {
    const { base, count } = parseExisting(entry);
    bump(base, count);
  }
  // Incoming strings are caller-sanitized/trimmed already; they are used as
  // literal text (never suffix-parsed) so a note whose own wording ends in
  // something like "(x2)" is never mistaken for a fold count.
  for (const raw of incoming) {
    if (!raw) continue;
    bump(raw.slice(0, BASE_MAX), 1);
  }

  return order.slice(0, cap).map((base) => {
    const count = counts.get(base) ?? 1;
    return count > 1 ? `${base} (x${count})` : base;
  });
}

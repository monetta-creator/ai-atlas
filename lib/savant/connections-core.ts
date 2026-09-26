// Pure shaping for Savant's cross-store connections and echoes (2026-09-26).
// PLAIN-NODE LOADABLE: no imports. The DB read (embeddings nearest-neighbor
// search against the argument map, and same-week nearest-neighbor search
// across kinds for echoes) lives elsewhere; this module only filters, caps,
// and dedupes what the read produces so the notebook writer stays testable
// without a database.

export interface RawConnection {
  recordKind: string;
  recordId: string;
  targetKind: 'claim' | 'bridge' | 'stance';
  targetId: string;
  sim: number;
}

export interface ShapeConnectionsOpts {
  minSim?: number;
  perRecord?: number;
  max?: number;
}

// Deterministic tiebreak below sim: recordKind, then recordId, then
// targetId, all ascending. Ties on sim are rare (embeddings), but the
// order must still be reproducible run to run.
function compareConnections(a: RawConnection, b: RawConnection): number {
  if (b.sim !== a.sim) return b.sim - a.sim;
  if (a.recordKind !== b.recordKind) return a.recordKind < b.recordKind ? -1 : 1;
  if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
  if (a.targetKind !== b.targetKind) return a.targetKind < b.targetKind ? -1 : 1;
  return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
}

export function shapeConnections(raw: RawConnection[], opts: ShapeConnectionsOpts = {}): RawConnection[] {
  const minSim = opts.minSim ?? 0.55;
  const perRecord = opts.perRecord ?? 2;
  const max = opts.max ?? 40;

  const byRecord = new Map<string, RawConnection[]>();
  for (const c of raw) {
    if (c.sim < minSim) continue;
    const key = `${c.recordKind}:${c.recordId}`;
    const arr = byRecord.get(key);
    if (arr) arr.push(c);
    else byRecord.set(key, [c]);
  }

  const kept: RawConnection[] = [];
  for (const arr of byRecord.values()) {
    const sorted = [...arr].sort(compareConnections);
    kept.push(...sorted.slice(0, perRecord));
  }

  return kept.sort(compareConnections).slice(0, max);
}

export interface RawEcho {
  aKind: string;
  aId: string;
  bKind: string;
  bId: string;
  sim: number;
}

export interface EchoShapeOpts {
  minSim?: number;
  max?: number;
}

export function shapeEchoes(raw: RawEcho[], opts: EchoShapeOpts = {}): RawEcho[] {
  const minSim = opts.minSim ?? 0.6;
  const max = opts.max ?? 15;

  const best = new Map<string, RawEcho>();
  for (const e of raw) {
    if (e.aKind === e.bKind) continue;
    if (e.sim < minSim) continue;
    const key = echoKey(e);
    const existing = best.get(key);
    if (!existing || e.sim > existing.sim) best.set(key, e);
  }

  return [...best.values()].sort((a, b) => (b.sim !== a.sim ? b.sim - a.sim : echoKey(a) < echoKey(b) ? -1 : 1)).slice(0, max);
}

export function connectionKey(c: RawConnection): string {
  return `${c.recordKind}:${c.recordId}->${c.targetKind}:${c.targetId}`;
}

// Sorted, unordered: (a,b) and (b,a) collapse to the same key.
export function echoKey(e: RawEcho): string {
  const a = `${e.aKind}:${e.aId}`;
  const b = `${e.bKind}:${e.bId}`;
  return [a, b].sort().join('~');
}

import { q } from '@/lib/db';
import { buildHypothesisPackCore } from './pack-core';
import type { PrevRun, HypothesisInput } from './pack-core';
import type { HypothesisPack } from '@/lib/types';

// App-facing wrapper for the deterministic pack builder. The core is query-injected
// (see pack-core.ts) so a determinism test can drive the same SQL from plain Node;
// the app always binds the shared pool.
export async function buildHypothesisPack(hyp: HypothesisInput, prev: PrevRun | null): Promise<HypothesisPack> {
  return buildHypothesisPackCore(q, hyp, prev);
}

import { q } from '@/lib/db';
import { buildThesisPackCore } from './pack-core';
import type { PrevRun, ThesisInput } from './pack-core';
import type { ThesisPack } from '@/lib/types';

// App-facing wrapper for the deterministic pack builder. The core is query-injected
// (see pack-core.ts) so the determinism test can drive the same SQL from plain Node;
// the app always binds the shared pool.
export async function buildThesisPack(thesis: ThesisInput, prev: PrevRun | null): Promise<ThesisPack> {
  return buildThesisPackCore(q, thesis, prev);
}

import { q } from '@/lib/db';
import { SIGNAL_LENS_LABEL } from '@/lib/format';
import type { SheetPack, SheetScope, SignalLens } from '@/lib/types';
import { buildClaimSheetPack, buildLensSheetPack, buildAtlasSheetPack } from './pack-core';

// The app-facing wrapper: binds the injected-Q pack builders (pure, Node-testable)
// to the real pool. Subject validation happens in the actions; this dispatches.
export async function buildSheetPack(
  kind: 'claim' | 'lens' | 'atlas',
  subject: string | null,
  scope: SheetScope
): Promise<SheetPack> {
  if (kind === 'lens') {
    const lens = subject as SignalLens;
    return buildLensSheetPack(q, lens, SIGNAL_LENS_LABEL[lens] ?? lens, scope);
  }
  if (kind === 'atlas') return buildAtlasSheetPack(q, scope);
  return buildClaimSheetPack(q, subject as string, scope);
}

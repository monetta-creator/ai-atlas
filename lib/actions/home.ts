'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './shared';
import { setHomeWidgets } from '../mutations/home';
import { isWidgetKey } from '../widgets/catalog';

// The Lobby's "Customize" save (admin only). An intentionally emptied board
// is rejected here, not in the data layer: getHomeWidgets falls back to
// DEFAULT_WIDGETS on a stored empty array (so a corrupted/cleared row never
// blanks the page), but the action itself should never let an admin save
// nothing on purpose — "pick at least one" is the better prompt than a board
// that silently reverts to the defaults on next load.
export async function saveHomeWidgetsAction(keys: string[]): Promise<void> {
  await requireAdmin();
  const clean = [...new Set((keys ?? []).map(String))].filter(isWidgetKey);
  if (clean.length > 24) throw new Error('Too many widgets.');
  if (clean.length === 0) throw new Error('Pick at least one widget.');
  await setHomeWidgets(clean);
  revalidatePath('/');
}

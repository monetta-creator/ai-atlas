'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './shared';
import { setBoardWidgets } from '../mutations/home';
import { isBoard, isWidgetOnBoard, type Board } from '../widgets/catalog';

// A board's "Customize" save (admin only). An intentionally emptied board is
// rejected here: getBoardWidgets falls back to the defaults on a stored empty
// array (so a cleared row never blanks the page), but saving nothing on
// purpose should prompt "pick at least one", not silently revert.
export async function saveBoardWidgetsAction(board: Board, keys: string[]): Promise<void> {
  await requireAdmin();
  if (!isBoard(board)) throw new Error('Unknown board.');
  const clean = [...new Set((keys ?? []).map(String))].filter((k) => isWidgetOnBoard(k, board));
  if (clean.length > 24) throw new Error('Too many widgets.');
  if (clean.length === 0) throw new Error('Pick at least one widget.');
  await setBoardWidgets(board, clean);
  revalidatePath(board === 'home' ? '/' : '/ops');
}

// The lobby's original entry point, kept for any caller that predates boards.
export async function saveHomeWidgetsAction(keys: string[]): Promise<void> {
  return saveBoardWidgetsAction('home', keys);
}

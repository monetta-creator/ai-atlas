import { one } from '../db';
import { DEFAULT_BOARD_WIDGETS, isWidgetOnBoard, type Board } from '../widgets/catalog';

// ---- Widget boards (migration 0075; the lobby's 0045 singleton before it) ---
// One saved layout per board. A missing row (never saved) or an empty stored
// array falls back to the board's defaults; a stored key that no longer names
// a widget on this board (a retired or moved widget) is dropped, the drift
// guard the rest of the app applies to code-defined enums stored in jsonb.

export async function getBoardWidgets(board: Board): Promise<string[]> {
  const row = await one<{ widgets: string[] }>(`select widgets from board_prefs where board = $1`, [board]);
  const stored = row?.widgets ?? [];
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_BOARD_WIDGETS[board];
  const clean = stored.map((k) => String(k)).filter((k) => isWidgetOnBoard(k, board));
  return clean.length ? clean : DEFAULT_BOARD_WIDGETS[board];
}

export async function getHomeWidgets(): Promise<string[]> {
  return getBoardWidgets('home');
}

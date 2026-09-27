import { exec } from '../db';
import type { Board } from '../widgets/catalog';

// ---- Widget boards (migration 0075) ----------------------------------------
// One row per board, created by its first save. Keys are validated
// (allow-listed for the board, deduped, capped) by the calling action.
export async function setBoardWidgets(board: Board, keys: string[]): Promise<void> {
  await exec(
    `insert into board_prefs (board, widgets) values ($1, $2::jsonb)
     on conflict (board) do update set widgets = excluded.widgets`,
    [board, JSON.stringify(keys)]
  );
}

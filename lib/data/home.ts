import { one } from '../db';
import { DEFAULT_WIDGETS, isWidgetKey } from '../widgets/catalog';

// ---- Home widget board (migration 0045) ------------------------------------
// The Lobby's customizable board. Missing row (never saved) or an empty
// stored array both fall back to DEFAULT_WIDGETS; a stored key that no
// longer names a catalog entry (a retired widget) is dropped, the drift
// guard the rest of the app applies to code-defined enums stored in jsonb.

export async function getHomeWidgets(): Promise<string[]> {
  const row = await one<{ widgets: string[] }>(`select widgets from home_prefs where id = true`);
  const stored = row?.widgets ?? [];
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_WIDGETS;
  const clean = stored.map((k) => String(k)).filter(isWidgetKey);
  return clean.length ? clean : DEFAULT_WIDGETS;
}

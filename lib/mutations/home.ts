import { exec } from '../db';

// ---- Home widget board (migration 0045) ------------------------------------
// The singleton write (the scan_prefs setScanEnabled pattern): created lazily
// by the first save. Keys are validated (allow-listed, deduped, capped) by
// the calling action, not here — the mutation trusts its input.
export async function setHomeWidgets(keys: string[]): Promise<void> {
  await exec(
    `insert into home_prefs (id, widgets) values (true, $1::jsonb)
     on conflict (id) do update set widgets = excluded.widgets, updated_at = now()`,
    [JSON.stringify(keys)]
  );
}

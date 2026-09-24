import { exec } from '../db';

// Writer for the ask_prefs singleton (migration 0066). Called from an admin
// server action (requireAdmin() there, never here — mutations are never the
// gate; see lib/mutations/shared.ts's own note on that split).
export async function setAskRetrieval(mode: 'fts' | 'hybrid'): Promise<void> {
  await exec(
    `insert into ask_prefs (id, retrieval) values (true, $1)
     on conflict (id) do update set retrieval = excluded.retrieval, updated_at = now()`,
    [mode]
  );
}

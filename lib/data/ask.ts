import { one } from '../db';

// The Ask retrieval pref singleton (migration 0066). Missing row = the
// default: FTS-only (hybrid ships only after scripts/ab-retrieval.mjs shows
// it does not move a covered question to thin — see the hybrid-retrieval plan).
export interface AskPrefs {
  retrieval: 'fts' | 'hybrid';
}

export async function getAskPrefs(): Promise<AskPrefs> {
  const row = await one<{ retrieval: string }>(`select retrieval from ask_prefs where id = true`);
  return { retrieval: row?.retrieval === 'hybrid' ? 'hybrid' : 'fts' };
}

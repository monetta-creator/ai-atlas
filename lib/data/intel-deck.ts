import { q, one } from '../db';
import type { SavedIntelDeck } from '../intel/deck-types';

// Reads for the company intel deck (generated_reports kind 'intel_deck',
// migrations 0061/0062). One row per day (scope_to). Portal-only content:
// every caller gates on lib/portal/identity.ts or isAdmin() before reading.

const DECK_ROW = `id, to_char(scope_to, 'YYYY-MM-DD') as scope_to, is_published, generated_at::text as generated_at, pack, narrative`;

export async function getIntelDeckForDay(day: string): Promise<SavedIntelDeck | null> {
  return one<SavedIntelDeck>(
    `select ${DECK_ROW} from generated_reports where kind = 'intel_deck' and scope_to = $1::date`,
    [day]
  );
}

export async function getLatestIntelDeck(publishedOnly = true): Promise<SavedIntelDeck | null> {
  return one<SavedIntelDeck>(
    `select ${DECK_ROW} from generated_reports
      where kind = 'intel_deck' ${publishedOnly ? 'and is_published = true' : ''}
      order by scope_to desc, generated_at desc limit 1`
  );
}

export async function listIntelDecks(limit = 30): Promise<{ id: string; scope_to: string; is_published: boolean; generated_at: string; companies: number; quiet: number }[]> {
  return q(
    `select id, to_char(scope_to, 'YYYY-MM-DD') as scope_to, is_published, generated_at::text as generated_at,
            coalesce((pack->'numbers'->>'companies')::int, 0) as companies,
            coalesce((pack->'numbers'->>'quiet')::int, 0) as quiet
       from generated_reports where kind = 'intel_deck'
      order by scope_to desc limit $1`,
    [limit]
  );
}

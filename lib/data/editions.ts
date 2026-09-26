import { one, q } from '../db';
import type { SavedEdition, EditionListRow, EditionPrefs } from '../edition/types';

// The daily edition's read layer (migration 0057). Editions are
// generated_reports rows (kind 'edition'); the day is the natural key
// (scope_to), so getEditionForDay is both the /blotter/<day> read and
// lib/edition/run.ts's idempotency check.

const EDITION_ROW = `id, scope_to::text as day, pack, narrative, is_published, generated_at::text as generated_at`;

export async function getEditionForDay(day: string): Promise<SavedEdition | null> {
  return one<SavedEdition>(
    `select ${EDITION_ROW} from generated_reports where kind = 'edition' and scope_to = $1::date`,
    [day]
  );
}

// The most recent edition (/blotter's default read). publishedOnly=false is
// for the admin console, which may want to see a not-yet-published row (in
// practice editions always auto-publish, but the flag mirrors every other
// generated-report reader's shape).
export async function getLatestEdition(publishedOnly: boolean): Promise<SavedEdition | null> {
  const where = publishedOnly ? "kind = 'edition' and is_published = true" : "kind = 'edition'";
  return one<SavedEdition>(
    `select ${EDITION_ROW} from generated_reports where ${where} order by scope_to desc limit 1`
  );
}

// The /blotter archive list: just enough to render a link per day, never the
// full pack (headline is the front's lead item; numbers is the pack's own
// numbers strip, projected without pulling the rest of the jsonb).
export async function listEditions(limit = 60, publishedOnly = true): Promise<EditionListRow[]> {
  const where = publishedOnly ? "kind = 'edition' and is_published = true" : "kind = 'edition'";
  return q<EditionListRow>(
    `select id, scope_to::text as day,
            narrative->'front'->0->>'headline' as headline,
            pack->'numbers' as numbers,
            is_published
       from generated_reports
      where ${where}
      order by scope_to desc
      limit $1`,
    [Math.max(1, Math.min(365, limit))]
  );
}

// The n most recent PUBLISHED editions strictly before `beforeDay` (newest
// first): lib/edition/pack.ts's repeat-penalty pass reads this to avoid
// re-running yesterday's (and the day before's) front page verbatim.
export async function getRecentEditions(beforeDay: string, n = 2): Promise<SavedEdition[]> {
  return q<SavedEdition>(
    `select ${EDITION_ROW} from generated_reports
      where kind = 'edition' and is_published = true and scope_to < $1::date
      order by scope_to desc
      limit $2`,
    [beforeDay, Math.max(1, n)]
  );
}

export async function countEditions(): Promise<number> {
  const row = await one<{ n: number }>(`select count(*)::int as n from generated_reports where kind = 'edition'`);
  return row?.n ?? 0;
}

export async function getEditionPrefs(): Promise<EditionPrefs> {
  const row = await one<{ enabled: boolean; model: string; front_items: number }>(
    `select enabled, model, front_items from edition_prefs where id = true`
  );
  return row ?? { enabled: true, model: 'z-ai/glm-5.3-flash', front_items: 6 };
}

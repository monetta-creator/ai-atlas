import { buildEditionPack, deterministicFront } from './pack';
import { generateFront, generateColumn } from './generate';
import { checkEditionBudget } from './budget';
import { getEditionForDay, getEditionPrefs } from '../data/editions';
import { saveGeneratedReport } from '../mutations';
import type { EditionNarrative } from './types';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// The daily edition's whole unit (the roundup's runWeeklyRoundup template,
// lib/research/roundup.ts): idempotent on the day, gated on edition_prefs,
// skips a quiet day outright (fewer than 3 clusters is not enough for a
// front page), and falls back to a deterministic front + no column when the
// daily model budget is spent. Auto-publishes (Kevin's 2026-09-23 call:
// /blotter/<day> must work sessionless, the third auto-publishing report
// kind after roundup and tooling_entrants).
export async function runDailyEdition(
  day: string = todayUTC()
): Promise<{ id: string; day: string; items: number } | { skipped: string }> {
  const existing = await getEditionForDay(day);
  if (existing) return { skipped: `already generated for ${day}` };

  const prefs = await getEditionPrefs();
  if (!prefs.enabled) return { skipped: 'edition disabled' };

  const pack = await buildEditionPack(day);
  if (pack.clusters.length < 3) return { skipped: 'quiet day: fewer than 3 story clusters' };

  const budget = await checkEditionBudget();

  let front;
  let column: EditionNarrative['column'];
  let model: string | null;
  let citedTags: string[] = [];
  let dropped: string[] = [];

  if (budget.ok) {
    front = await generateFront(pack, prefs.model, prefs.front_items);
    const columnOut = await generateColumn(pack, front, prefs.model);
    column = { title: columnOut.title, html: columnOut.html };
    citedTags = columnOut.cited;
    dropped = columnOut.dropped;
    model = prefs.model;
  } else {
    front = deterministicFront(pack, prefs.front_items);
    column = { title: 'No column today', html: '' };
    model = null;
  }

  const narrative: EditionNarrative = { front, column, citedTags, dropped, model };

  const day1 = new Date(`${pack.day}T00:00:00Z`);
  day1.setUTCDate(day1.getUTCDate() + 1);

  const reportId = await saveGeneratedReport({
    kind: 'edition',
    subject: null,
    title: front[0]?.headline ?? `Daily edition, ${pack.day}`,
    scope_from: pack.windowFrom.slice(0, 10),
    scope_to: pack.day,
    pack,
    narrative,
    generated_at: pack.generatedAt,
    isPublished: true,
  });

  return { id: reportId, day: pack.day, items: front.length };
}

import { buildEditionPack } from './pack';
import { deterministicFront, thingsHappenFor, EDITION_PRESS_UTC } from './pure';
import { generateFront, generateColumn } from './generate';
import { checkEditionBudget } from './budget';
import { getEditionForDay, getEditionPrefs } from '../data/editions';
import { saveGeneratedReport, deleteGeneratedReport } from '../mutations';
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
// opts.replaceEarly (the scheduled cron passes it): an edition that was built
// BEFORE the day's press time is a preview, written by a manual run while the
// engines were still enriching (2026-09-24: a 9:59 ET run read 74 items where
// the 12:45 ET press would have read over 100). The scheduled run replaces it
// once press time has passed; a manual re-run still skips, so a human's
// deliberate edition is never clobbered by another human click.
export async function runDailyEdition(
  day: string = todayUTC(),
  opts: { replaceEarly?: boolean } = {}
): Promise<{ id: string; day: string; items: number; replaced?: boolean } | { skipped: string }> {
  const existing = await getEditionForDay(day);
  let replaced = false;
  if (existing) {
    const press = new Date(`${day}T${EDITION_PRESS_UTC}Z`).getTime();
    const builtEarly = new Date(existing.generated_at).getTime() < press;
    if (!(opts.replaceEarly && builtEarly && Date.now() >= press)) {
      return { skipped: `already generated for ${day}` };
    }
    await deleteGeneratedReport(existing.id);
    replaced = true;
  }

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
    // A malformed model reply (the cheap endpoints do this now and then) must
    // not cost the day its paper: fall back leg by leg to the deterministic
    // front and a missing column, and record why.
    model = prefs.model;
    try {
      front = await generateFront(pack, prefs.model, prefs.front_items);
    } catch (e) {
      front = deterministicFront(pack, prefs.front_items);
      dropped = [`front leg failed: ${e instanceof Error ? e.message : 'model error'}`];
    }
    try {
      const columnOut = await generateColumn(pack, front, prefs.model);
      column = { title: columnOut.title, html: columnOut.html };
      citedTags = columnOut.cited;
      dropped = [...dropped, ...columnOut.dropped];
    } catch (e) {
      column = { title: 'No column today', html: '' };
      dropped = [...dropped, `column leg failed: ${e instanceof Error ? e.message : 'model error'}`];
    }
  } else {
    front = deterministicFront(pack, prefs.front_items);
    column = { title: 'No column today', html: '' };
    model = null;
  }

  const narrative: EditionNarrative = { front, column, citedTags, dropped, model };

  // Things happen = every ranked cluster the front did not take, so a story
  // the model picked from past the default tail start never renders twice.
  const frontIds = new Set(front.map((f) => f.clusterId));
  pack.thingsHappen = thingsHappenFor(pack.clusters, frontIds);

  let reportId: string;
  try {
    reportId = await saveGeneratedReport({
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
  } catch (e) {
    // generated_reports_edition_day_uq (0058): a concurrent run won the day.
    if ((e as { code?: string } | null)?.code === '23505') return { skipped: `already generated for ${pack.day}` };
    throw e;
  }

  return { id: reportId, day: pack.day, items: front.length, ...(replaced ? { replaced: true } : {}) };
}

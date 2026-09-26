import { windowFor } from '../edition/pure';
import { getNotebook, getSavantPrefs, getSelfCompany } from '../data/savant';
import { appendNotebook, insertHypothesis, setSavantPrefs } from '../mutations/savant';
import type { NotebookEntry } from '../mutations/savant';
import { connectionEntries } from './connections';
import { anomalyEntries } from './anomalies';
import { missEntries } from './misses';
import { makeMondayPlan, hypothesisExistsForWeek } from './plan';
import { writeDailyNote } from './note';
import { checkSavantBudget } from './budget';
import { issueWindow, isMonday, utcDate, weekEndFor } from './week';
import type { PlanPayload } from './types';

// Savant's weekday pass (2026-09-26), one unit per day after the edition's
// press: deterministic legs first (connections through the embeddings table,
// metric and volume anomalies, misses), then the Monday plan when the week
// has none yet, then one cheap diary note. Every entry upserts on its dedupe
// key, so re-running a day is safe; the Friday issue reads the whole week.

export interface NotebookDayResult {
  day: string;
  weekEnd: string;
  written: number;
  connections: { raw: number; kept: number; echoes: number };
  anomalies: { metric: number; volume: number; silent: number };
  misses: { coverage: number; quietTopics: number; quietQuestions: number };
  plan: 'new' | 'existing' | 'skipped';
  note: boolean;
  budget: { ok: boolean; spentUsd: number; capUsd: number };
}

// opts.skipPlan / skipNote: the deterministic legs only (a backfill of a
// closed week, or a dry look at what the join finds) without posing a
// hypothesis or spending on a note.
export async function runNotebookDay(
  day: string,
  opts: { skipPlan?: boolean; skipNote?: boolean } = {}
): Promise<NotebookDayResult | { skipped: string }> {
  const prefs = await getSavantPrefs();
  if (!prefs.enabled) return { skipped: 'savant disabled' };

  const weekEnd = weekEndFor(day);
  const dayWindow = windowFor(day);            // the edition's press-to-press day (Monday reaches back to Friday)
  const week = issueWindow(weekEnd);
  const isFriday = utcDate(day).getUTCDay() === 5;
  const budget = await checkSavantBudget(weekEnd);

  const conn = await connectionEntries({ from: dayWindow.from, to: dayWindow.to }, week.from);
  const anom = await anomalyEntries(week.from, dayWindow.to, isFriday);
  const miss = await missEntries(week.from, dayWindow.to, isFriday);
  const entries: NotebookEntry[] = [...conn.entries, ...anom.entries, ...miss.entries];

  // The plan: Monday's job, or the first pass of a week that has none (a
  // Tuesday backfill still gets a plan).
  let planState: NotebookDayResult['plan'] = 'skipped';
  let plan: PlanPayload | null = null;
  const existingPlan = (await getNotebook(weekEnd, ['plan']))[0]?.payload as PlanPayload | undefined;
  if (existingPlan) {
    plan = existingPlan;
    planState = 'existing';
  } else if (!opts.skipPlan && (isMonday(day) || !existingPlan)) {
    const self = await getSelfCompany();
    plan = await makeMondayPlan({ day, weekEnd, prefs, self, budgetOk: budget.ok });
    entries.push({ kind: 'plan', key: 'plan', payload: plan });
    if (!(await hypothesisExistsForWeek(weekEnd))) {
      await insertHypothesis({
        statement: plan.hypothesis.statement,
        question_slug: plan.question_slug,
        posed_week: weekEnd,
        what_would_settle: plan.hypothesis.what_would_settle_it,
        watch: plan.hypothesis.watch,
      });
    }
    if (prefs.lead_override) await setSavantPrefs({ lead_override: null });
    planState = 'new';
  }

  // The diary note, last, over today's entries; skipped past the cap.
  let noteWritten = false;
  if (budget.ok && !opts.skipNote) {
    const note = await writeDailyNote({ day, weekEnd, model: prefs.notebook_model, plan, entries });
    if (note) {
      entries.push({ kind: 'note', key: 'note', payload: note });
      noteWritten = true;
    }
  }

  const written = await appendNotebook(weekEnd, day, entries);
  return {
    day, weekEnd, written,
    connections: conn.stats, anomalies: anom.stats, misses: miss.stats,
    plan: planState, note: noteWritten, budget,
  };
}

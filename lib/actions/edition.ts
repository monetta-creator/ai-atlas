'use server';

import { requireAdmin, ISO_DAY_RE } from './shared';
import { runDailyEdition } from '../edition/run';
import { saveEditionPrefs } from '../mutations/editions';
import type { EditionPrefsPatch } from '../mutations/editions';

// Admin controls for the daily edition console strip: a manual run (the
// cron's own bounded-work pattern, one call, typed-arg / returns data rather
// than redirecting, like the pipeline's step actions) and the prefs editor.

export async function runEditionNowAction(day?: string) {
  await requireAdmin();
  const target = day && ISO_DAY_RE.test(day) ? day : undefined;
  return runDailyEdition(target);
}

export async function setEditionPrefsAction(patch: EditionPrefsPatch): Promise<void> {
  await requireAdmin();
  await saveEditionPrefs(patch ?? {});
}

'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import { requireAdmin, str } from './shared';
import { ISO_DAY_RE } from './shared';

// ===== AI cost monitoring (migration 0014) ==================================
// Add a new pricing card (the /costs dashboard form). useActionState-shaped (like
// saveContentAction): returns the result as data so the form shows an inline error and stays
// put, then revalidates /costs. The effective date is REQUIRED — the form has no default, so
// a card can never silently take effect "today" without the admin choosing the date.
export type AddRateCardState = { ok: boolean; error?: string };

const MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// Parse one USD-per-million-tokens rate. Required, finite, 0–100000.
function parseRate(fd: FormData, key: string, label: string): number {
  const raw = str(fd, key);
  if (raw === '') throw new Error(`${label} is required.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new Error(`${label} must be a number between 0 and 100000.`);
  return n;
}

export async function addRateCardAction(
  _prev: AddRateCardState,
  formData: FormData
): Promise<AddRateCardState> {
  await requireAdmin();
  try {
    const model = str(formData, 'model');
    if (!MODEL_RE.test(model)) return { ok: false, error: 'Enter a valid model id (e.g. claude-sonnet-4-6).' };

    const effective_date = str(formData, 'effective_date');
    if (!ISO_DAY_RE.test(effective_date)) {
      return { ok: false, error: 'An explicit effective date (YYYY-MM-DD) is required.' };
    }

    const input_per_mtok = parseRate(formData, 'input_per_mtok', 'Input price');
    const output_per_mtok = parseRate(formData, 'output_per_mtok', 'Output price');
    const cache_write_per_mtok = parseRate(formData, 'cache_write_per_mtok', 'Cache-write price');
    const cache_read_per_mtok = parseRate(formData, 'cache_read_per_mtok', 'Cache-read price');

    const context_window = Number(str(formData, 'context_window'));
    if (!Number.isInteger(context_window) || context_window <= 0 || context_window > 100_000_000) {
      return { ok: false, error: 'Context window must be a positive whole number of tokens.' };
    }

    await m.addRateCard({
      model, effective_date, input_per_mtok, output_per_mtok,
      cache_write_per_mtok, cache_read_per_mtok, context_window,
    });
    revalidatePath('/costs');
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not add the rate card.';
    // unique (model, effective_date) → a friendly message instead of a 500.
    if (/duplicate key|unique/i.test(msg)) {
      return { ok: false, error: 'A rate card for that model and effective date already exists.' };
    }
    return { ok: false, error: msg };
  }
}

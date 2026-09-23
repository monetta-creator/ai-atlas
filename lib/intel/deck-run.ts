import { buildIntelDeckPack } from './deck-pack';
import { generateIntelDeckNarrative } from './deck-generate';
import { checkIntelDeckBudget } from './deck-budget';
import { getIntelDeckForDay } from '../data/intel-deck';
import { getIntelPrefs } from '../data/intel';
import { saveGeneratedReport } from '../mutations';
import { dateLabel } from '../format';
import type { IntelDeckNarrative } from './deck-types';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// The company intel deck's whole unit (the daily edition's runDailyEdition
// template): idempotent on the day (getIntelDeckForDay + the 0062 unique
// index), gated on intel_prefs.deck_enabled, a deterministic deck when the
// model budget is spent or the call fails, saved as generated_reports kind
// 'intel_deck' and PUBLISHED at once: the kind is portal-only, so publishing
// puts it in front of access-key holders and the admin, never guests.
export async function runIntelDeck(
  day: string = todayUTC()
): Promise<{ id: string; day: string; companies: number; sentences: number } | { skipped: string }> {
  const existing = await getIntelDeckForDay(day);
  if (existing) return { skipped: `already generated for ${day}` };

  const prefs = await getIntelPrefs();
  if (!prefs.deck_enabled) return { skipped: 'intel deck disabled' };

  const pack = await buildIntelDeckPack(day);
  if (pack.companies.length === 0) return { skipped: 'quiet day: no tracked company had anything in the window' };

  let narrative: IntelDeckNarrative = { sentences: [], frontHtml: null, model: null, dropped: [] };
  const budget = await checkIntelDeckBudget();
  if (budget.ok) {
    try {
      narrative = await generateIntelDeckNarrative(pack, prefs.deck_model);
    } catch (e) {
      narrative = { sentences: [], frontHtml: null, model: prefs.deck_model, dropped: [`narrative failed: ${e instanceof Error ? e.message : 'model error'}`] };
    }
  } else {
    narrative.dropped.push(`budget cap reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}): deterministic deck`);
  }

  const lead = pack.movers[0];
  // Headlines usually open with the company name already; prefix it only when they do not.
  const title = lead?.headline
    ? (lead.headline.toLowerCase().startsWith(lead.name.toLowerCase()) ? lead.headline : `${lead.name}: ${lead.headline}`)
    : `Company intel, ${dateLabel(day) ?? day}`;
  try {
    const id = await saveGeneratedReport({
      kind: 'intel_deck',
      subject: null,
      title: title.slice(0, 160),
      scope_from: pack.windowFrom.slice(0, 10),
      scope_to: day,
      pack,
      narrative,
      generated_at: pack.generatedAt,
      isPublished: true,
    });
    return { id, day, companies: pack.companies.length, sentences: narrative.sentences.length };
  } catch (e) {
    // generated_reports_intel_deck_day_uq (0062): a concurrent run won the day.
    if ((e as { code?: string } | null)?.code === '23505') return { skipped: `already generated for ${day}` };
    throw e;
  }
}

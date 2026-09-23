// Tavily quota circuit breaker (the GDELT breaker's shape, lib/scan/search-gdelt.ts).
// Tavily answers HTTP 432 when the plan's monthly credits are spent, and the
// answer does not change for the rest of the month; on 2026-09-23 every
// engine still fired its full search plan into it (30+ doomed calls and 30+
// identical notes per run). One 432 trips the breaker for 15 minutes by
// default (one 700s work budget), and the engines check tavilyAvailable()
// before each search leg and skip the leg with ONE note. Module state, and
// Fluid Compute reuses warm instances across invocations, so the trip lasts
// that window rather than the month: the next cron window re-learns with one
// call, and the ?rerun= recovery routes reset it outright.
// Invariant: the breaker is tripped only by a live 432 inside tavilyQuery /
// searchTopicNewsTavily, which throw before fetching when TAVILY_API_KEY is
// unset, so an unset key never trips it and callers need no env check in
// front of tavilyAvailable().
export const TAVILY_QUOTA_STATUS = 432;
let tavilyDownUntil = 0;

export function tavilyAvailable(): boolean {
  return Date.now() >= tavilyDownUntil;
}

export function markTavilyQuotaExhausted(ms = 15 * 60_000): void {
  tavilyDownUntil = Date.now() + ms;
}

// Read for tests and for callers that want to reset between runs.
export function resetTavilyBreaker(): void {
  tavilyDownUntil = 0;
}

export const TAVILY_QUOTA_NOTE = 'Tavily quota exhausted (432)';

// The two note spellings of a spent quota: the per-unit `Tavily ${status}`
// error text the engines noted before 2026-09-23, and TAVILY_QUOTA_NOTE
// since. Used verbatim as a Postgres regex via .source (the reopen*
// mutations strip matching notes), so keep it to plain alternation, no
// JS-only syntax.
export const TAVILY_QUOTA_NOTE_RE = /Tavily 432|Tavily quota exhausted/i;

// What a completed run's notes say went missing (the Daily Jobs widget's
// amber reason). The spent Tavily quota is the one known case.
export function tavilyQuotaWarning(notesText: string | null): string | null {
  if (!notesText) return null;
  return TAVILY_QUOTA_NOTE_RE.test(notesText) ? 'search legs skipped: Tavily quota' : null;
}

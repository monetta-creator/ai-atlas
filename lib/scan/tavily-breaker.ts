// Tavily quota circuit breaker (the GDELT breaker's shape, lib/scan/search-gdelt.ts).
// Tavily answers HTTP 432 when the plan's monthly credits are spent, and the
// answer does not change for the rest of the month; on 2026-09-23 every
// engine still fired its full search plan into it (30+ doomed calls and 30+
// identical notes per run). One 432 trips the breaker for the rest of this
// process, and the engines check tavilyAvailable() before each search leg
// and skip the leg with ONE note. Module state: it protects one serverless
// invocation (one cron window); the next window re-learns with one call.
export const TAVILY_QUOTA_STATUS = 432;
let tavilyDownUntil = 0;

export function tavilyAvailable(): boolean {
  return Date.now() >= tavilyDownUntil;
}

export function markTavilyQuotaExhausted(ms = 6 * 60 * 60_000): void {
  tavilyDownUntil = Date.now() + ms;
}

// Read for tests and for callers that want to reset between runs.
export function resetTavilyBreaker(): void {
  tavilyDownUntil = 0;
}

export function isTavilyQuotaError(e: unknown): boolean {
  return /\bTavily 432\b/.test(String((e as Error)?.message ?? ''));
}

export const TAVILY_QUOTA_NOTE = 'Tavily quota exhausted (432)';

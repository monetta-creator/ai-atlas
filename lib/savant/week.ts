// Week arithmetic for Savant (plain-Node loadable, no imports). An issue is
// keyed by its Friday (`week_end`); the notebook writes rows for the Friday
// of the week the day falls in. Saturday and Sunday belong to the NEXT
// issue (nothing runs on them today, but a manual backfill may).

const DAY_MS = 86_400_000;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

// The Friday that closes the week containing `day`.
export function weekEndFor(day: string): string {
  const d = utcDate(day);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  // Mon(1)..Fri(5) -> this week's Friday; Sat(6) -> next Friday (+6); Sun(0) -> next Friday (+5)
  const delta = dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow;
  return isoDay(new Date(d.getTime() + delta * DAY_MS));
}

// The issue window: the previous Friday's press time to this Friday's, the
// edition's 16:45 UTC boundary so both papers agree on what "this week" is.
export const SAVANT_PRESS_UTC = '16:45:00';

export function issueWindow(weekEnd: string): { from: string; to: string } {
  const to = new Date(`${weekEnd}T${SAVANT_PRESS_UTC}Z`);
  const from = new Date(to.getTime() - 7 * DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

// The weekdays of the week ending on `weekEnd`, Monday first.
export function weekdaysOf(weekEnd: string): string[] {
  const fri = utcDate(weekEnd);
  return [4, 3, 2, 1, 0].map((back) => isoDay(new Date(fri.getTime() - back * DAY_MS)));
}

export function previousWeekEnd(weekEnd: string): string {
  return isoDay(new Date(utcDate(weekEnd).getTime() - 7 * DAY_MS));
}

export function isMonday(day: string): boolean {
  return utcDate(day).getUTCDay() === 1;
}

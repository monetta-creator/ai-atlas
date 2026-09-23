// Pure date/time helpers for the Atlas Agent. No DB import, so
// scripts/test-agent.mjs can load this module directly (the plain-Node
// type-stripping trick every other lib test script uses).

// The standing rule: never create a day-keyed engine run between 00:00 and
// 09:00 UTC (a run created then consumes the next morning's run key).
export function isBlackout(now: Date): boolean {
  const h = now.getUTCHours();
  return h >= 0 && h < 9;
}

export function isWeekdayUtc(now: Date): boolean {
  const d = now.getUTCDay(); // 0 Sun .. 6 Sat
  return d >= 1 && d <= 5;
}

export function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

export function daysSince(iso: string, now: Date): number {
  return hoursSince(iso, now) / 24;
}

// Monday of the current UTC week, as YYYY-MM-DD (the tooling engine's week key).
export function mondayUtc(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Most recent Friday at or before today, UTC, as YYYY-MM-DD.
export function lastFridayUtc(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow >= 5 ? dow - 5 : dow + 2;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

// A short, human age label for a card ("3 days", "6 hours", "under an hour").
export function ageLabel(iso: string, now: Date): string {
  const hrs = hoursSince(iso, now);
  if (hrs < 1) return 'under an hour';
  if (hrs < 24) {
    const h = Math.floor(hrs);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

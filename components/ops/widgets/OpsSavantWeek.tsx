import Link from 'next/link';
import { isoDay, weekEndFor, weekdaysOf } from '@/lib/savant/week';
import { getNotebook, getSavantWeekSpend } from '@/lib/data/savant';
import { listSavantIssues } from '@/lib/data/savant-issues';

const KIND_LABEL: Record<string, string> = {
  connection: 'connections', echo: 'echoes', anomaly: 'anomalies', miss: 'misses',
  note: 'notes', plan: 'plan', query: 'queries', editor: 'editor',
};

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// 'ops-savant-week': this week's notebook by day, the next issue's fire
// times, and the last published issue's cost and link.
export default async function OpsSavantWeek() {
  const weekEnd = weekEndFor(isoDay(new Date()));
  let rows: Awaited<ReturnType<typeof getNotebook>>;
  let spend = 0;
  let lastIssue: Awaited<ReturnType<typeof listSavantIssues>>[number] | null = null;
  try {
    [rows, spend, lastIssue] = await Promise.all([
      getNotebook(weekEnd),
      getSavantWeekSpend(weekEnd),
      listSavantIssues(1, true).then((r) => r[0] ?? null),
    ]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const days = weekdaysOf(weekEnd);
  const byDay = new Map<string, Map<string, number>>();
  for (const day of days) byDay.set(day, new Map());
  for (const r of rows) {
    const m = byDay.get(r.day);
    if (!m) continue;
    m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
  }

  return (
    <>
      <div className="lw-head">Savant this week</div>
      <div className="lw-sub">week ending {weekEnd} · next issue Friday 20:00 UTC (sweeps 20:20, 20:40)</div>
      <ul className="ops-notes" style={{ fontSize: 12, marginTop: 8 }}>
        {days.map((day) => {
          const m = byDay.get(day);
          const parts = m && m.size ? [...m.entries()].map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`).join(', ') : 'no entries';
          return <li key={day}>{dayLabel(day)}: {parts}</li>;
        })}
      </ul>
      {lastIssue && (
        <div className="lw-sub" style={{ marginTop: 6 }}>
          Last issue {lastIssue.issueNumber != null ? `#${lastIssue.issueNumber} ` : ''}
          <Link href={`/savant/${lastIssue.week_end}`}>{lastIssue.title}</Link>
        </div>
      )}
      <div className="lw-sub">this week’s spend · ${spend.toFixed(2)}</div>
      <Link href="/savant/desk" className="lw-foot">Savant desk →</Link>
    </>
  );
}

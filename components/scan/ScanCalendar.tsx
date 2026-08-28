'use client';

import { useState } from 'react';

// The scan's day grid (the contribution-calendar form): one cell per calendar
// day, completed days on a single-hue intensity ramp by item volume, failed
// days in the reserved status color, empty days outlined. Identity is never
// color-alone: every cell carries an aria-label, the hover tooltip restates
// everything, and the legend labels each state. Completed cells ARE the
// archive: clicking one downloads that day's JSON.

export interface ScanCalDay {
  day: string; // 'YYYY-MM-DD'
  status: 'completed' | 'failed' | 'running' | null;
  feed: number;
  search: number;
  hydrated: number;
  enriched: number;
  skipped: number;
  cost: number | null;
  downloadHref: string | null;
}

const CELL = 15;
const GAP = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function intensity(items: number): number {
  if (items <= 0) return 0.22;
  if (items < 20) return 0.45;
  if (items < 40) return 0.65;
  if (items < 70) return 0.85;
  return 1;
}

function cellStyle(d: ScanCalDay | null): React.CSSProperties {
  const base: React.CSSProperties = { width: CELL, height: CELL, borderRadius: 3, display: 'block' };
  if (!d) return { ...base, background: 'transparent' }; // pre-window padding
  if (d.status === 'completed') {
    return { ...base, background: 'var(--supports)', opacity: intensity(d.feed + d.search) };
  }
  if (d.status === 'failed') return { ...base, background: 'var(--heat-4)' };
  if (d.status === 'running') return { ...base, background: 'var(--accent)', opacity: 0.7 };
  return { ...base, background: 'transparent', border: '1px solid var(--line)' };
}

function labelOf(d: ScanCalDay): string {
  if (!d.status) return `${d.day}: no run`;
  const items = d.feed + d.search;
  return `${d.day}: ${d.status}, ${items} items (${d.feed} feed, ${d.search} search), ${d.hydrated} hydrated, ${d.enriched} enriched, ${d.skipped} skipped${
    typeof d.cost === 'number' ? `, $${d.cost.toFixed(2)}` : ''
  }${d.downloadHref ? '. Click to download the day as JSON.' : ''}`;
}

export default function ScanCalendar({ days }: { days: ScanCalDay[] }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Column-per-week, Monday-first: pad the front so days[0] lands on its
  // actual weekday row.
  const firstDow = days.length ? (new Date(`${days[0].day}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const padded: (ScanCalDay | null)[] = [...Array<null>(firstDow).fill(null), ...days];
  const weeks: (ScanCalDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  // A month label above the first column whose first real day enters a new month.
  const monthLabels = weeks.map((week, i) => {
    const first = week.find(Boolean);
    if (!first) return '';
    const m = Number(first.day.slice(5, 7)) - 1;
    const prev = i > 0 ? weeks[i - 1].find(Boolean) : null;
    const prevM = prev ? Number(prev.day.slice(5, 7)) - 1 : -1;
    return m !== prevM ? MONTHS[m] : '';
  });

  const show = (d: ScanCalDay) => (e: React.MouseEvent) =>
    setTip({ text: labelOf(d), x: e.clientX, y: e.clientY });

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: GAP, marginBottom: 4 }}>
          {monthLabels.map((m, i) => (
            <span
              key={i}
              className="text-xs"
              style={{ width: CELL, color: 'var(--faint-ink)', fontSize: 10, overflow: 'visible', whiteSpace: 'nowrap' }}
            >
              {m}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: GAP }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
              {Array.from({ length: 7 }, (_, di) => {
                const d = week[di] ?? null;
                if (!d) return <span key={di} style={cellStyle(null)} aria-hidden="true" />;
                const common = {
                  style: cellStyle(d),
                  'aria-label': labelOf(d),
                  onMouseEnter: show(d),
                  onMouseMove: show(d),
                  onMouseLeave: () => setTip(null),
                };
                return d.downloadHref ? (
                  <a key={di} href={d.downloadHref} title="" {...common} />
                ) : (
                  <span key={di} tabIndex={0} {...common} />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
        <span className="flex items-center gap-1">
          <span style={{ ...cellStyle({ day: '', status: null, feed: 0, search: 0, hydrated: 0, enriched: 0, skipped: 0, cost: null, downloadHref: null }), width: 11, height: 11 }} />
          no run
        </span>
        <span className="flex items-center gap-1">
          items
          {[1, 20, 40, 70].map((n) => (
            <span key={n} style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--supports)', opacity: intensity(n) }} />
          ))}
          more
        </span>
        <span className="flex items-center gap-1">
          <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--heat-4)' }} />
          failed
        </span>
        <span className="flex items-center gap-1">
          <span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--accent)', opacity: 0.7 }} />
          in progress
        </span>
        <span>· click a green day to download its JSON</span>
      </div>

      {tip && (
        <div
          role="tooltip"
          className="text-xs"
          style={{
            position: 'fixed', left: Math.min(tip.x + 12, typeof window !== 'undefined' ? window.innerWidth - 280 : tip.x), top: tip.y + 14,
            zIndex: 60, maxWidth: 270, padding: '8px 10px', borderRadius: 8, pointerEvents: 'none',
            background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--dim)',
            boxShadow: '0 4px 14px rgba(0,0,0,.18)',
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}

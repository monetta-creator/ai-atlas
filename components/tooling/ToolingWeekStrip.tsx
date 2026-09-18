'use client';

import { useState } from 'react';

// The weekly engine's history strip (the IntelCalendar contribution-cell
// idiom, flattened to one row since there is exactly one run per week):
// one cell per Monday over the trailing 26 weeks, completed weeks on a
// single-hue intensity ramp by inserted_count, failed weeks in the
// reserved status color, weeks with no run outlined. Identity is never
// color-alone: every cell carries an aria-label, the hover tooltip
// restates everything, and the legend labels each state.
export interface ToolingWeekCell {
  day: string; // 'YYYY-MM-DD', the Monday UTC
  status: 'completed' | 'failed' | 'running' | null;
  inserted: number;
  cataloged: number;
  deepDived: number;
  cost: number | null;
  reportHref: string | null;
}

const CELL = 16;
const GAP = 4;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function intensity(inserted: number): number {
  if (inserted <= 0) return 0.22;
  if (inserted < 10) return 0.45;
  if (inserted < 25) return 0.65;
  if (inserted < 50) return 0.85;
  return 1;
}

function cellStyle(w: ToolingWeekCell): React.CSSProperties {
  const base: React.CSSProperties = { width: CELL, height: CELL, borderRadius: 3, display: 'block' };
  if (w.status === 'completed') return { ...base, background: 'var(--supports)', opacity: intensity(w.inserted) };
  if (w.status === 'failed') return { ...base, background: 'var(--heat-4)' };
  if (w.status === 'running') return { ...base, background: 'var(--accent)', opacity: 0.7 };
  return { ...base, background: 'transparent', border: '1px solid var(--line)' };
}

function labelOf(w: ToolingWeekCell): string {
  if (!w.status) return `week of ${w.day}: no run`;
  return `week of ${w.day}: ${w.status}, ${w.inserted} inserted, ${w.cataloged} cataloged, ${w.deepDived} deep dive${w.deepDived === 1 ? '' : 's'}${
    typeof w.cost === 'number' ? `, $${w.cost.toFixed(2)}` : ''
  }${w.reportHref ? '. Click to read the week\'s entrants report.' : ''}`;
}

export default function ToolingWeekStrip({ weeks }: { weeks: ToolingWeekCell[] }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const monthLabels = weeks.map((w, i) => {
    const m = Number(w.day.slice(5, 7)) - 1;
    const prevM = i > 0 ? Number(weeks[i - 1].day.slice(5, 7)) - 1 : -1;
    return m !== prevM ? MONTHS[m] : '';
  });

  const show = (w: ToolingWeekCell) => (e: React.MouseEvent) =>
    setTip({ text: labelOf(w), x: e.clientX, y: e.clientY });

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: GAP, marginBottom: 4 }}>
          {monthLabels.map((m, i) => (
            <span key={i} className="text-xs" style={{ width: CELL, color: 'var(--faint-ink)', fontSize: 10, overflow: 'visible', whiteSpace: 'nowrap' }}>
              {m}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: GAP }}>
          {weeks.map((w) => {
            const common = {
              style: cellStyle(w),
              'aria-label': labelOf(w),
              onMouseEnter: show(w),
              onMouseMove: show(w),
              onMouseLeave: () => setTip(null),
            };
            return w.reportHref ? (
              <a key={w.day} href={w.reportHref} title="" {...common} />
            ) : (
              <span key={w.day} tabIndex={0} {...common} />
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
        <span className="flex items-center gap-1">
          <span style={{ width: 11, height: 11, borderRadius: 3, background: 'transparent', border: '1px solid var(--line)' }} />
          no run
        </span>
        <span className="flex items-center gap-1">
          inserted
          {[1, 10, 25, 50].map((n) => (
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
        <span>· click a green week for its entrants report</span>
      </div>

      {tip && (
        <div
          role="tooltip"
          className="text-xs"
          style={{
            position: 'fixed', left: Math.min(tip.x + 12, typeof window !== 'undefined' ? window.innerWidth - 280 : tip.x), top: tip.y + 14,
            zIndex: 60, maxWidth: 280, padding: '8px 10px', borderRadius: 8, pointerEvents: 'none',
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

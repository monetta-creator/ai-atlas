'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Signal } from '@/lib/types';
import { dateLabel, signalLensColor } from '@/lib/format';
import { SignificanceTag } from './SignalBadges';

// The "In context" thread, as a compact table instead of full signal cards: one scannable
// row per related development (lens dot, headline link, significance, date). Long lists are
// capped to INITIAL rows with a "Show all" toggle so the detail page stays short.
const INITIAL = 8;

export default function RelatedSignalsTable({ signals }: { signals: Signal[] }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? signals : signals.slice(0, INITIAL);
  const hidden = signals.length - rows.length;

  return (
    <div>
      <table className="related-table">
        <thead>
          <tr>
            <th>Development</th>
            <th>Significance</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="rt-title">
                <span
                  className="rt-dot"
                  style={{ background: s.lenses.length ? signalLensColor(s.lenses[0]) : 'var(--line)' }}
                />
                <Link href={`/signals/${s.id}`}>{s.title}</Link>
              </td>
              <td className="rt-sig"><SignificanceTag significance={s.significance} /></td>
              <td className="rt-date">{dateLabel(s.published_at) ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => setExpanded(true)}
          style={{ marginTop: 10 }}
        >
          Show all {signals.length}
        </button>
      )}
    </div>
  );
}

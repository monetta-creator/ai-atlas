import Link from 'next/link';
import type { Signal, Significance } from '@/lib/types';
import { signalContextColor, SIGNAL_CONTEXT_LABEL, SIGNIFICANCE_LABEL } from '@/lib/format';

// The signal wire (Console Broadsheet, right column): latest published signals as
// dated ruled rows — tabular date, significance dot, headline, context dot + touch
// count. The Snacks daily-list pattern in the Atlas's own vocabulary (heat and
// context colors instead of emoji). Styles: .bs-wire* / .bs-row* in home.css.

const SIG_TONE: Record<Significance, string> = {
  high: 'var(--heat-4)',
  medium: 'var(--heat-2)',
  low: 'var(--faint-ink)',
};

// "07.17" — the wire dateline (year lives in the masthead).
function wireDate(publishedAt: string | Date | null): string {
  if (!publishedAt) return '––.––';
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return '––.––';
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function TopSignalsPanel({ signals }: { signals: Signal[] }) {
  return (
    <div className="bs-col" style={{ minWidth: 0 }}>
      <div className="section-label bs-colhead">
        The signal wire
        <Link href="/signals">The board →</Link>
      </div>
      {signals.length === 0 ? (
        <p className="ls-empty">No published signals yet.</p>
      ) : (
        <ol className="bs-list">
          {signals.map((s) => {
            const n = s.touches.length;
            return (
              <li key={s.id}>
                <Link href={`/signals/${s.id}`} className="bs-row">
                  <span className="bs-wire-date">{wireDate(s.published_at)}</span>
                  <span
                    className="bs-sigdot"
                    style={{ background: SIG_TONE[s.significance] }}
                    title={`${SIGNIFICANCE_LABEL[s.significance]} significance`}
                  />
                  <span className="bs-rowbody">
                    <span className="bs-rowhed">{s.title}</span>
                    <span className="bs-tags">
                      <span className="bs-lensdots">
                        <i style={{ background: signalContextColor(s.context) }} title={SIGNAL_CONTEXT_LABEL[s.context]} />
                      </span>
                      <span style={{ color: n ? 'var(--accent)' : undefined }}>
                        {n} hypothes{n === 1 ? 'is' : 'es'} touched
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

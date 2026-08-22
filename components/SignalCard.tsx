import Link from 'next/link';
import type { Signal } from '@/lib/types';
import { dateLabel, touchHref, signalContextColor, SIGNAL_CONTEXT_LABEL } from '@/lib/format';
import { publishSignalAction, archiveSignalAction, unarchiveSignalAction } from '@/lib/actions';
import { SignificanceTag } from './SignalBadges';

// One post-it on the pinboard. Tinted paper + top bar in the context's color,
// a context dot instead of a full badge (the grid is 4-across), title and blurb clamped
// by CSS. The card is a container (not a single Link) because the touch chips are
// themselves links; the title links to the detail page. `redirectTo` is where the
// admin actions return after a publish/archive. The inline viewTransitionName lets
// filter/page changes morph cards between positions (see SignalFeed).
const TOUCH_CAP = 4;

export default function SignalCard({
  signal, admin, redirectTo = '/signals',
}: { signal: Signal; admin: boolean; redirectTo?: string }) {
  const accent = signal.context ? signalContextColor(signal.context) : 'var(--line)';
  const date = dateLabel(signal.published_at);
  const touches = signal.touches.slice(0, TOUCH_CAP);
  const moreTouches = signal.touches.length - touches.length;

  return (
    <div
      className="signal-card"
      style={{
        borderTopColor: accent,
        background: `color-mix(in oklab, ${accent} 8%, var(--surface))`,
        viewTransitionName: `sig-${signal.id}`,
      }}
    >
      <div className="signal-top">
        <span className="bs-lensdots">
          <i style={{ background: signalContextColor(signal.context) }} title={SIGNAL_CONTEXT_LABEL[signal.context]} />
        </span>
        <SignificanceTag significance={signal.significance} />
        {admin && !signal.is_published && (
          <span className="sig-tag" style={{ color: 'var(--heat-2)' }}>
            {signal.archived_at ? 'Archived' : 'Draft'}
          </span>
        )}
        {admin && (
          <span className="sig-tag" style={{ color: 'var(--faint-ink)' }}>{signal.origin}</span>
        )}
      </div>

      <h3>
        <Link href={`/signals/${signal.id}`} className="signal-title-link">{signal.title}</Link>
      </h3>

      {signal.summary && <p className="blurb">{signal.summary}</p>}

      {touches.length > 0 && (
        <div className="touches">
          {touches.map((code: string) => (
            <Link key={code} href={touchHref(code)} className="touch-chip">{code}</Link>
          ))}
          {moreTouches > 0 && <span className="touch-label">+{moreTouches}</span>}
        </div>
      )}

      <div className="signal-meta">
        {date && <span>{date}</span>}
        {signal.source_title && (
          <>
            <span className="dot" />
            {signal.source_url ? (
              <a href={signal.source_url} target="_blank" rel="noopener noreferrer" className="signal-source-link">
                {signal.source_title}
              </a>
            ) : (
              <span>{signal.source_title}</span>
            )}
          </>
        )}
      </div>

      {admin && (
        <div className="signal-admin-row">
          <form action={publishSignalAction}>
            <input type="hidden" name="id" value={signal.id} />
            <input type="hidden" name="publish" value={signal.is_published ? '0' : '1'} />
            <input type="hidden" name="redirect_to" value={redirectTo} />
            <button type="submit" className="btn btn--quiet btn--sm">
              {signal.is_published ? 'Unpublish' : 'Publish'}
            </button>
          </form>
          <Link href={`/signals/${signal.id}/edit`} className="btn btn--quiet btn--sm">Edit</Link>
          {/* Archive applies only to drafts — set aside without publishing or deleting. */}
          {!signal.is_published && (
            <form action={signal.archived_at ? unarchiveSignalAction : archiveSignalAction}>
              <input type="hidden" name="id" value={signal.id} />
              <input type="hidden" name="redirect_to" value={redirectTo} />
              <button type="submit" className="btn btn--quiet btn--sm">
                {signal.archived_at ? 'Unarchive' : 'Archive'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sprintDecisionAction } from '@/lib/actions';
import { dateLabel, touchHref, SIGNAL_LENS_LABEL, SIGNIFICANCE_LABEL } from '@/lib/format';
import type { Signal } from '@/lib/types';

// One draft at a time: title, summary, source, every claim touch with its
// direction and reason, and three decisions. P publishes (the human gate:
// evidence materializes), A archives (set aside, kept), S skips to the next
// and parks this one at the end of the session's queue. Left arrow steps
// back to a skipped draft. Sorted high significance first, newest first.
export default function DraftSprint({
  drafts, statements,
}: {
  drafts: Signal[];
  statements: Record<string, string>;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<Signal[]>(drafts);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState({ published: 0, archived: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);

  const current = queue[index] ?? null;
  const remaining = queue.length - index;

  async function decide(decision: 'publish' | 'archive') {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sprintDecisionAction(current.id, decision);
      setQueue((qq) => qq.filter((d) => d.id !== current.id));
      setDone((d) => ({ ...d, [decision === 'publish' ? 'published' : 'archived']: d[decision === 'publish' ? 'published' : 'archived'] + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That failed.');
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (!current || busy) return;
    setQueue((qq) => [...qq.slice(0, index), ...qq.slice(index + 1), current]);
    setDone((d) => ({ ...d, skipped: d.skipped + 1 }));
  }

  function back() {
    if (busy || index === 0) return;
    setIndex((i) => i - 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); void decide('publish'); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); void decide('archive'); }
      else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // decide/skip/back close over current state; re-binding per render is the simple, correct thing here.
  });

  const touches = useMemo(() => {
    if (!current) return [];
    return current.claim_touches.map((code) => ({
      code,
      statement: statements[code] ?? null,
      detail: current.touch_details?.[code] ?? null,
    }));
  }, [current, statements]);

  if (!current) {
    return (
      <div className="ds ds-empty">
        <p>
          Queue clear. This session: {done.published} published · {done.archived} archived.
        </p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => router.refresh()}>Refresh</button>
      </div>
    );
  }

  return (
    <div className="ds">
      <div className="ds-head">
        <span className="ds-progress">
          {remaining} to review · {done.published} published · {done.archived} archived{done.skipped ? ` · ${done.skipped} skipped` : ''}
        </span>
        <span className="ds-keys">P publish · A archive · S skip · ← back</span>
      </div>

      <article className="ds-card" data-sig={current.significance}>
        <div className="ds-meta">
          <span className="ds-sig">{SIGNIFICANCE_LABEL[current.significance]}</span>
          {current.lenses.map((l) => <span key={l} className="ds-lens">{SIGNAL_LENS_LABEL[l]}</span>)}
          <span className="dot" />
          <span>drafted {dateLabel(current.created_at)}</span>
          {current.drafted_by && <span className="ds-model">· {current.drafted_by.split('/').pop()}</span>}
        </div>
        <h2 className="ds-title">{current.title}</h2>
        {current.summary && <p className="ds-summary">{current.summary}</p>}
        {current.source_url && (
          <p className="ds-source">
            <a href={current.source_url} target="_blank" rel="noopener noreferrer">
              {current.source_title || current.source_url} ↗
            </a>
          </p>
        )}

        <div className="ds-touches">
          <div className="section-label">Claim touches · {touches.length}</div>
          {touches.length === 0 && <p className="ds-none">Touches no claim: publishing adds no evidence.</p>}
          {touches.map((t) => (
            <div key={t.code} className="ds-touch" data-dir={t.detail?.direction ?? 'neutral'}>
              <Link href={touchHref(t.code)} className="touch-chip" target="_blank">{t.code}</Link>
              <div className="ds-touch-body">
                {t.statement && <div className="ds-touch-statement">{t.statement}</div>}
                {t.detail ? (
                  <div className="ds-touch-reason">
                    <span className="ds-dir">{t.detail.direction}</span> {t.detail.reason}
                  </div>
                ) : (
                  <div className="ds-touch-reason ds-none">No direction or reason recorded.</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="ds-actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void decide('publish')}>Publish <kbd>P</kbd></button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void decide('archive')}>Archive <kbd>A</kbd></button>
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={skip}>Skip <kbd>S</kbd></button>
          <Link href={`/signals/${current.id}/edit`} className="btn btn--quiet" target="_blank">Edit ↗</Link>
          {index > 0 && <button type="button" className="btn btn--quiet" disabled={busy} onClick={back}>← Back</button>}
        </div>
        {error && <p className="ds-error">{error}</p>}
      </article>
    </div>
  );
}

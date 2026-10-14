'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewPaperAction } from '@/lib/actions';
import { dateLabel, touchHref } from '@/lib/format';
import { prefillWhy } from '@/lib/research/queue-core';
import type { SprintPaper } from '@/lib/types';

// One paper at a time, the signal draft sprint's grammar applied to the
// research queue: the agent's call and why, the finding when the engine has
// already extracted one, the plain-language summary, advisory touches and
// threads, then four decisions. T opens the track why (prefilled with the
// agent's reason when it recommended tracking; Enter commits, Esc cancels),
// N notes, D dismisses, S skips to the end of the session's queue, the left
// arrow steps back to a skipped paper, O opens the paper itself.

type Decision = 'tracked' | 'noted' | 'dismissed';

const REC_LABEL: Record<string, string> = { tracked: 'track', noted: 'note', dismissed: 'dismiss' };

export default function PaperSprint({
  papers, statements, threads,
}: {
  papers: SprintPaper[];
  statements: Record<string, string>;
  threads: Record<string, string>;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<SprintPaper[]>(papers);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState({ tracked: 0, noted: 0, dismissed: 0, skipped: 0, agreed: 0 });
  const [error, setError] = useState<string | null>(null);
  // null = the why field is closed; a string = open with that text.
  const [why, setWhy] = useState<string | null>(null);
  // Written and read only inside event handlers (never during render).
  const lastDecisionAt = useRef(0);

  const current = queue[0] ?? null;
  const canBack = skipped.some((id) => queue.some((p) => p.id === id));

  async function decide(decision: Decision, note = '') {
    if (!current || busy) return;
    if (decision === 'tracked' && !note.trim()) return;
    const t = Date.now();
    if (t - lastDecisionAt.current < 400) return;
    lastDecisionAt.current = t;
    setBusy(true);
    setError(null);
    try {
      await reviewPaperAction(current.id, decision, note.trim());
      setQueue((qq) => qq.filter((p) => p.id !== current.id));
      setDone((d) => ({
        ...d,
        [decision]: d[decision] + 1,
        agreed: d.agreed + (current.agent_recommendation === decision ? 1 : 0),
      }));
      setWhy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That failed.');
    } finally {
      setBusy(false);
    }
  }

  function openTrack() {
    if (!current || busy) return;
    setWhy(prefillWhy(current.agent_recommendation, current.agent_reason));
  }

  function skip() {
    if (!current || busy) return;
    setWhy(null);
    setQueue((qq) => [...qq.slice(1), current]);
    setSkipped((s) => [...s, current.id]);
    setDone((d) => ({ ...d, skipped: d.skipped + 1 }));
  }

  function back() {
    if (busy) return;
    const live = skipped.filter((id) => queue.some((p) => p.id === id));
    const id = live[live.length - 1];
    if (!id) return;
    setWhy(null);
    setSkipped(live.slice(0, -1));
    setQueue((qq) => {
      const p = qq.find((x) => x.id === id);
      return p ? [p, ...qq.filter((x) => x.id !== id)] : qq;
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Ignore auto-repeat: a held key would otherwise decide one paper per round trip.
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); openTrack(); }
      else if (k === 'n') { e.preventDefault(); void decide('noted'); }
      else if (k === 'd') { e.preventDefault(); void decide('dismissed'); }
      else if (k === 's' || e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (k === 'o' && current) { e.preventDefault(); window.open(current.url, '_blank', 'noopener'); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // decide/skip/back close over current state; re-binding per render is the simple, correct thing here.
  });

  const decided = done.tracked + done.noted + done.dismissed;

  if (!current) {
    return (
      <div className="ds ds-empty">
        <p>
          Queue clear. This session: {done.tracked} tracked · {done.noted} noted · {done.dismissed} dismissed
          {decided > 0 ? ` · agreed with the agent on ${done.agreed} of ${decided}` : ''}.
        </p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => router.refresh()}>Refresh</button>
      </div>
    );
  }

  const rec = current.agent_recommendation;
  const finding = current.extraction;
  const authors = current.authors.slice(0, 3).join(', ') + (current.authors.length > 3 ? ' et al.' : '');

  return (
    <div className="ds">
      <div className="ds-head">
        <span className="ds-progress">
          {queue.length} to review · {done.tracked} tracked · {done.noted} noted · {done.dismissed} dismissed
          {done.skipped ? ` · ${done.skipped} skipped` : ''}
          {decided > 0 ? ` · agreed ${done.agreed}/${decided}` : ''}
        </span>
        <span className="ds-keys">T track · N note · D dismiss · S skip · ← back · O open</span>
      </div>

      <article className="ds-card ps-card" data-rec={rec ?? 'none'}>
        <div className="ds-meta">
          {rec ? (
            <span className="ps-rec">
              Agent · {REC_LABEL[rec] ?? rec}{current.agent_confidence != null ? ` · ${current.agent_confidence}` : ''}
            </span>
          ) : (
            <span className="ps-rec">Agent has not read this yet</span>
          )}
          {current.agent_cluster && <span className="ds-lens">{current.agent_cluster}</span>}
          <span className="dot" />
          <span>{current.published_at ? dateLabel(current.published_at) : 'undated'}</span>
          {current.categories.slice(0, 3).map((c) => <span key={c}>{c}</span>)}
          {current.author_hindex != null && <span>· h-max {current.author_hindex}</span>}
          {current.citation_count != null && current.citation_count > 0 && <span>· {current.citation_count} cites</span>}
        </div>
        <h2 className="ds-title">{current.title}</h2>
        {authors && <p className="ps-authors">{authors}</p>}

        {current.agent_reason && (
          <p className="ps-why"><span className="ds-dir">Agent</span>{current.agent_reason}</p>
        )}

        {finding?.headline_claim && (
          <div className="ps-finding">
            <div className="section-label">Finding</div>
            <p>{finding.headline_claim}</p>
            {finding.effect_size && <p className="ps-sub">{finding.effect_size}</p>}
          </div>
        )}

        {current.triage_summary ? (
          <p className="ds-summary">{current.triage_summary}</p>
        ) : current.abstract ? (
          <p className="ds-summary">{current.abstract.slice(0, 700)}{current.abstract.length > 700 ? '…' : ''}</p>
        ) : null}
        {current.triage_summary && current.abstract && (
          <details className="ps-abstract">
            <summary>Abstract</summary>
            <p>{current.abstract}</p>
          </details>
        )}

        {(current.claim_touches.length > 0 || current.suggested_threads.length > 0) && (
          <div className="ds-touches">
            <div className="section-label">Bears on · advisory</div>
            {current.claim_touches.map((code) => (
              <div key={code} className="ds-touch" data-dir="neutral">
                <Link href={touchHref(code)} className="touch-chip" target="_blank">{code}</Link>
                <div className="ds-touch-body">
                  <div className="ds-touch-statement">{statements[code] ?? 'Unknown code'}</div>
                </div>
              </div>
            ))}
            {current.suggested_threads.length > 0 && (
              <p className="ps-sub">
                Threads: {current.suggested_threads.map((s) => threads[s] ?? s).join(' · ')}
              </p>
            )}
          </div>
        )}

        <p className="ds-source">
          <a href={current.url} target="_blank" rel="noopener noreferrer">Open the paper ↗</a>
          {' · '}
          <Link href={`/research/${current.id}`} target="_blank">Library page ↗</Link>
        </p>

        {why !== null ? (
          <div className="ps-track">
            <input
              className="input" autoFocus
              placeholder="Why track this paper? (required)"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && why.trim()) { e.preventDefault(); void decide('tracked', why); }
                if (e.key === 'Escape') { e.preventDefault(); setWhy(null); }
              }}
            />
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || !why.trim()}
              onClick={() => void decide('tracked', why)}>
              Track <kbd>↵</kbd>
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setWhy(null)}>Cancel <kbd>Esc</kbd></button>
          </div>
        ) : (
          <div className="ds-actions">
            <button type="button" className={rec === 'tracked' ? 'btn btn--primary' : 'btn btn--ghost'} disabled={busy} onClick={openTrack}>
              Track <kbd>T</kbd>
            </button>
            <button type="button" className={rec === 'noted' ? 'btn btn--primary' : 'btn btn--ghost'} disabled={busy}
              onClick={() => void decide('noted')}>
              Note <kbd>N</kbd>
            </button>
            <button type="button" className={rec === 'dismissed' ? 'btn btn--primary' : 'btn btn--ghost'} disabled={busy}
              onClick={() => void decide('dismissed')}>
              Dismiss <kbd>D</kbd>
            </button>
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={skip}>Skip <kbd>S</kbd></button>
            {canBack && <button type="button" className="btn btn--quiet" disabled={busy} onClick={back}>← Back</button>}
          </div>
        )}
        {error && <p className="ds-error">{error}</p>}
      </article>
    </div>
  );
}

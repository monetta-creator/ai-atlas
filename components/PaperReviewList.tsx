'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewPaperAction } from '@/lib/actions';
import type { Paper } from '@/lib/types';

// The review queue: triage-kept papers awaiting the human decision. Track requires a
// why (the rationales discipline applied to papers); Note and Dismiss are one click.
// Each decision is a server action; router.refresh() re-reads the queue.
const PAGE_SIZE = 10;

export default function PaperReviewList({ papers }: { papers: Paper[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Decisions shrink the list underneath the pager — clamp instead of stranding
  // the admin on a page that no longer exists.
  const totalPages = Math.max(1, Math.ceil(papers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const shown = papers.slice(start, start + PAGE_SIZE);

  const decide = (paperId: string, status: 'tracked' | 'noted' | 'dismissed', why = '') => {
    setError(null);
    startTransition(async () => {
      try {
        await reviewPaperAction(paperId, status, why);
        setTrackingId(null);
        setNote('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'error');
      }
    });
  };

  if (!papers.length) {
    return (
      <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
        No papers waiting for review. Run a pull, or add one manually below.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</p>}
      {papers.length > PAGE_SIZE && (
        <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Showing {start + 1}–{Math.min(start + PAGE_SIZE, papers.length)} of {papers.length}
        </div>
      )}
      {shown.map((p) => (
        <div
          key={p.id}
          className="rounded-[var(--radius)] border p-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
        >
          <div className="flex items-center flex-wrap gap-2 text-xs" style={{ marginBottom: 4 }}>
            <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>paper</span>
            {p.published_at && <span style={{ color: 'var(--faint-ink)' }}>· {p.published_at}</span>}
          </div>

          <div className="flex items-baseline gap-2 flex-wrap">
            <Link href={`/research/${p.id}`} className="text-sm hover:underline" style={{ color: 'var(--ink)' }}>
              {p.title}
            </Link>
            <a href={p.url} target="_blank" rel="noopener noreferrer"
              className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
              ↗
            </a>
          </div>

          {p.triage_summary && (
            <div className="text-sm" style={{ color: 'var(--dim)', marginTop: 4 }}>{p.triage_summary}</div>
          )}
          {p.triage_reason && (
            <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 4 }}>
              Why it&rsquo;s here: {p.triage_reason}
            </div>
          )}
          {p.abstract && (
            <details style={{ marginTop: 4 }}>
              <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
                Abstract
              </summary>
              <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 4, lineHeight: 1.6 }}>{p.abstract}</p>
            </details>
          )}

          {p.agent_recommendation && (
            <div className="text-xs" style={{ marginTop: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: p.agent_recommendation === 'tracked' ? 'var(--supports)'
                    : p.agent_recommendation === 'dismissed' ? 'var(--faint-ink)' : 'var(--accent)',
                }}
              >
                ✦ agent: {p.agent_recommendation === 'tracked' ? 'track' : p.agent_recommendation === 'noted' ? 'note' : 'dismiss'}
                {p.agent_confidence != null ? ` · ${p.agent_confidence}` : ''}
                {p.agent_cluster ? ` · ${p.agent_cluster}` : ''}
              </span>
              {p.agent_reason && <span style={{ color: 'var(--dim)' }}> · {p.agent_reason}</span>}
            </div>
          )}

          {(p.touches.length > 0 || p.suggested_threads.length > 0 || p.suggested_concepts.length > 0) && (
            <div className="flex items-center flex-wrap gap-2 text-xs" style={{ marginTop: 6, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
              {p.touches.map((c: string) => <span key={`c-${c}`}>[{c}]</span>)}
              {p.suggested_threads.map((t) => <span key={`t-${t}`}>thread:{t}</span>)}
              {p.suggested_concepts.map((s) => <span key={`s-${s}`}>concept:{s}</span>)}
            </div>
          )}

          <div className="flex items-center flex-wrap gap-2" style={{ marginTop: 8 }}>
            {trackingId === p.id ? (
              <>
                <input
                  className="input" style={{ flex: 1, minWidth: 200 }} autoFocus
                  placeholder="Why track this paper? (required)"
                  value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && note.trim()) decide(p.id, 'tracked', note.trim());
                    if (e.key === 'Escape') { setTrackingId(null); setNote(''); }
                  }}
                />
                <button
                  className="btn btn--primary btn--sm" disabled={pending || !note.trim()}
                  onClick={() => decide(p.id, 'tracked', note.trim())}
                >
                  Track
                </button>
                <button className="btn btn--quiet btn--sm" onClick={() => { setTrackingId(null); setNote(''); }}>
                  Cancel
                </button>
              </>
            ) : (
              <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <button
                  className="btn btn--ghost btn--sm" disabled={pending}
                  onClick={() => {
                    setTrackingId(p.id);
                    // The agent's argument doubles as a draft "why"; still editable.
                    setNote(p.agent_recommendation === 'tracked' ? (p.agent_reason ?? '') : '');
                  }}
                >
                  ★ Track
                </button>
                <button className="btn btn--quiet btn--sm" disabled={pending} onClick={() => decide(p.id, 'noted')}>
                  Note
                </button>
                <button className="btn btn--quiet btn--sm" disabled={pending} onClick={() => decide(p.id, 'dismissed')}>
                  Dismiss
                </button>
              </span>
            )}
          </div>
        </div>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3" style={{ marginTop: 10 }}>
          <button className="btn btn--ghost btn--sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            ← Prev
          </button>
          <span className="text-xs" style={{ color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            Page {safePage} of {totalPages}
          </span>
          <button className="btn btn--ghost btn--sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  confirmPaperConceptAction, removePaperConceptAction,
  placePaperInThreadAction, removePaperFromThreadAction,
} from '@/lib/actions';
import type { ThreadRelation } from '@/lib/types';

const RELATIONS: ThreadRelation[] = ['supports', 'complicates', 'contradicts', 'context'];

export interface SuggestedThreadPlacement {
  slug: string;
  title: string;
  relation: ThreadRelation;
  why: string;
}

// The model's concept/thread proposals (papers.suggested_* + extraction placements)
// with human confirm/remove — the propose->queue->accept flow concept_link_status_t
// was future-proofed for. Confirmed rows are what the thread and concept pages read.
export default function PaperLinksPanel({
  paperId,
  suggestedConcepts,           // model-proposed, not yet confirmed: [{slug, name}]
  confirmedConcepts,           // [{slug, name}] (name null = drift flag)
  suggestedThreads,            // model-proposed placements, not yet confirmed
  confirmedThreads,            // [{slug, title, relation, why}]
  allThreads,                  // for the manual placement picker
}: {
  paperId: string;
  suggestedConcepts: { slug: string; name: string }[];
  confirmedConcepts: { slug: string; name: string | null }[];
  suggestedThreads: SuggestedThreadPlacement[];
  confirmedThreads: { slug: string; title: string; relation: string; why: string | null }[];
  allThreads: { slug: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [manualThread, setManualThread] = useState('');
  const [manualRelation, setManualRelation] = useState<ThreadRelation>('context');

  const act = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'error');
      }
    });
  };

  const unplacedThreads = allThreads.filter(
    (t) => !confirmedThreads.some((c) => c.slug === t.slug) && !suggestedThreads.some((s) => s.slug === t.slug)
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</p>}

      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>Concepts</div>
        <div className="flex flex-col gap-1.5">
          {confirmedConcepts.map((c) => (
            <div key={c.slug} className="flex items-center gap-2 text-sm flex-wrap">
              {c.name ? (
                <Link href={`/concepts/${c.slug}`} className="hover:underline" style={{ color: 'var(--ink)' }}>{c.name}</Link>
              ) : (
                <span style={{ color: 'var(--heat-4)' }}>{c.slug} (no longer exists)</span>
              )}
              <button className="btn btn--quiet btn--sm" disabled={pending}
                onClick={() => act(() => removePaperConceptAction(paperId, c.slug))}>
                Remove
              </button>
            </div>
          ))}
          {suggestedConcepts.map((c) => (
            <div key={c.slug} className="flex items-center gap-2 text-sm flex-wrap">
              <span style={{ color: 'var(--dim)' }}>✦ {c.name}</span>
              <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>suggested</span>
              <button className="btn btn--ghost btn--sm" disabled={pending}
                onClick={() => act(() => confirmPaperConceptAction(paperId, c.slug))}>
                Confirm
              </button>
            </div>
          ))}
          {!confirmedConcepts.length && !suggestedConcepts.length && (
            <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>No concept links yet. Analyze the paper for suggestions.</p>
          )}
        </div>
      </div>

      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>Threads</div>
        <div className="flex flex-col gap-1.5">
          {confirmedThreads.map((t) => (
            <div key={t.slug} className="text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/research/threads/${t.slug}`} className="hover:underline" style={{ color: 'var(--ink)' }}>{t.title}</Link>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{t.relation}</span>
                <button className="btn btn--quiet btn--sm" disabled={pending}
                  onClick={() => act(() => removePaperFromThreadAction(paperId, t.slug))}>
                  Remove
                </button>
              </div>
              {t.why && <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 2 }}>{t.why}</div>}
            </div>
          ))}
          {suggestedThreads.map((t) => (
            <div key={t.slug} className="text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ color: 'var(--dim)' }}>✦ {t.title}</span>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{t.relation}</span>
                <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>suggested</span>
                <button className="btn btn--ghost btn--sm" disabled={pending}
                  onClick={() => act(() => placePaperInThreadAction(paperId, t.slug, t.relation, t.why))}>
                  Confirm
                </button>
              </div>
              {t.why && <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 2 }}>{t.why}</div>}
            </div>
          ))}
          {unplacedThreads.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
              <select className="input" style={{ maxWidth: 260 }} value={manualThread}
                onChange={(e) => setManualThread(e.target.value)}>
                <option value="">Place in a thread…</option>
                {unplacedThreads.map((t) => <option key={t.slug} value={t.slug}>{t.title}</option>)}
              </select>
              <select className="input" style={{ maxWidth: 140 }} value={manualRelation}
                onChange={(e) => setManualRelation(e.target.value as ThreadRelation)}>
                {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn btn--ghost btn--sm" disabled={pending || !manualThread}
                onClick={() => act(() => placePaperInThreadAction(paperId, manualThread, manualRelation, ''))}>
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

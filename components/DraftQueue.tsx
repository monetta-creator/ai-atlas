'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SignalsPageResult, DedupeRecommendation, DedupeGroup, DedupeMember } from '@/lib/types';
import {
  dedupeDraftsAction, mergeDraftSignalsAction, discardDraftSignalAction,
  dismissDedupeGroupAction, clearDedupeScanAction,
} from '@/lib/actions';
import SignalFeed from './SignalFeed';

// The admin Draft queue: a MANUAL duplicate scan over ALL unpublished drafts, plus the
// browsable draft list. The scan only flags + recommends — the human merges or discards.
// After any action the draft list re-fetches (reloadToken) so it stays in sync, and the
// acted-on group is pruned from the results.
export default function DraftQueue({
  active, archived, initialRec,
}: { active: SignalsPageResult; archived: SignalsPageResult; initialRec: DedupeRecommendation | null }) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  // Seed from the persisted scan (reconciled server-side against live drafts) so the review
  // survives a refresh; replaced when the admin runs a fresh scan.
  const [rec, setRec] = useState<DedupeRecommendation | null>(initialRec);
  const [scanning, setScanning] = useState(false);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const draftCount = active.total;

  const groups = rec?.groups ?? [];
  const dupTotal = groups.reduce((n, g) => n + g.duplicates.length, 0);

  async function onScan() {
    if (scanning || acting) return;
    setScanning(true);
    setNote(null);
    try {
      setRec(await dedupeDraftsAction());
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Scan failed.', err: true });
    } finally {
      setScanning(false);
    }
  }

  async function onMerge(g: DedupeGroup) {
    if (acting) return;
    setActing(true);
    setNote(null);
    try {
      await mergeDraftSignalsAction(g.canonical.signal_id, g.duplicates.map((d) => d.signal_id));
      setRec((r) => (r ? { ...r, groups: r.groups.filter((x) => x.canonical.signal_id !== g.canonical.signal_id) } : r));
      setReloadToken((t) => t + 1);
      setNote({ text: `Merged ${g.duplicates.length} draft${g.duplicates.length === 1 ? '' : 's'} into “${g.canonical.title}”. Sources appended to its summary.` });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Merge failed.', err: true });
    } finally {
      setActing(false);
    }
  }

  async function onDiscard(g: DedupeGroup, m: DedupeMember) {
    if (acting) return;
    setActing(true);
    setNote(null);
    try {
      await discardDraftSignalAction(m.signal_id);
      setRec((r) => {
        if (!r) return r;
        const next = r.groups
          .map((x) =>
            x.canonical.signal_id === g.canonical.signal_id
              ? { ...x, duplicates: x.duplicates.filter((d) => d.signal_id !== m.signal_id) }
              : x
          )
          .filter((x) => x.duplicates.length > 0);
        return { ...r, groups: next };
      });
      setReloadToken((t) => t + 1);
      setNote({ text: `Discarded “${m.title}”.` });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'Discard failed.', err: true });
    } finally {
      setActing(false);
    }
  }

  // Persistence here is best-effort — the local state is authoritative for the session, and
  // reconcile-on-load self-heals if a persist call fails — so swallow errors (no unhandled reject).
  function onDismiss(g: DedupeGroup) {
    setRec((r) => (r ? { ...r, groups: r.groups.filter((x) => x.canonical.signal_id !== g.canonical.signal_id) } : r));
    dismissDedupeGroupAction(g.canonical.signal_id).catch(() => {});
  }

  function onClearResults() {
    setRec(null);
    clearDedupeScanAction().catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Active / Archived toggle — Archived shows set-aside drafts (no dedupe). */}
      <div className="flex items-center gap-2" style={{ fontSize: 13 }}>
        <button type="button" className="lenschip" data-on={view === 'active' ? '' : undefined} onClick={() => setView('active')}>
          Active drafts ({active.total})
        </button>
        <button type="button" className="lenschip" data-on={view === 'archived' ? '' : undefined} onClick={() => setView('archived')}>
          Archived ({archived.total})
        </button>
      </div>

      {view === 'archived' ? (
        <SignalFeed key="archived" initial={archived} status="archived" admin redirectTo="/signals/drafts" />
      ) : (
        <>
      {/* Duplicate-scan panel */}
      <div
        className="plate"
        style={{ padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Find duplicate drafts</div>
            <p style={{ fontSize: 13, color: 'var(--faint-ink)', margin: '4px 0 0', maxWidth: 560 }}>
              Scan the queue for the same development reported by different sources. Nothing changes
              automatically. You choose what to merge or discard.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onScan}
            disabled={scanning || acting || draftCount < 2}
            title={draftCount < 2 ? 'Need at least 2 drafts to scan' : undefined}
          >
            {scanning ? 'Scanning…' : rec ? 'Scan again' : `Scan ${draftCount} draft${draftCount === 1 ? '' : 's'}`}
          </button>
        </div>

        {note && (
          <div style={{ fontSize: 12.5, color: note.err ? 'var(--heat-4)' : 'var(--accent)' }}>{note.text}</div>
        )}

        {/* Results */}
        {rec && !scanning && (
          groups.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--supports)' }}>
              ✓ No duplicates found among {rec.scanned} draft{rec.scanned === 1 ? '' : 's'}.
            </div>
          ) : (
            <div className="flex flex-col gap-3" style={{ opacity: acting ? 0.6 : 1, transition: 'opacity .15s' }}>
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
                Found <strong>{groups.length}</strong> possible duplicate group{groups.length === 1 ? '' : 's'}{' '}
                ({dupTotal} draft{dupTotal === 1 ? '' : 's'} flagged). For each group the AI suggests one to{' '}
                <strong>keep</strong>. <strong>Merge</strong> folds the rest into it (their claim links and source
                URLs are combined onto the one you keep); <strong>Discard</strong> drops one outright. Open a draft
                to read it first, or hit <em>Not duplicates</em> to dismiss a group.
              </div>
              {groups.map((g) => (
                <div
                  key={g.canonical.signal_id}
                  className="rounded-[var(--radius)] border p-3"
                  style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
                >
                  <div style={{ fontSize: 12.5, color: 'var(--faint-ink)', marginBottom: 8 }}>“{g.reason}”</div>

                  {/* keep */}
                  <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 13.5, marginBottom: 4 }}>
                    <span className="badge badge--accent" style={{ fontSize: 10, padding: '2px 8px', flexShrink: 0 }}>KEEP</span>
                    <Link href={`/signals/${g.canonical.signal_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                      {g.canonical.title}
                    </Link>
                    {g.canonical.source_domain && (
                      <span style={{ fontSize: 11, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>· {g.canonical.source_domain}</span>
                    )}
                  </div>

                  {/* duplicates */}
                  {g.duplicates.map((m) => (
                    <div key={m.signal_id} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 13, padding: '3px 0 3px 14px' }}>
                      <span style={{ color: 'var(--faint-ink)', flexShrink: 0 }}>↳ duplicate</span>
                      <Link href={`/signals/${m.signal_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--dim)', flex: 1, minWidth: 120 }}>
                        {m.title}
                      </Link>
                      {m.source_domain && (
                        <span style={{ fontSize: 11, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{m.source_domain}</span>
                      )}
                      <button type="button" className="btn btn--quiet btn--sm" disabled={acting} onClick={() => onDiscard(g, m)} style={{ color: 'var(--heat-4)' }}>
                        Discard
                      </button>
                    </div>
                  ))}

                  {/* group actions */}
                  <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn--primary btn--sm" disabled={acting} onClick={() => onMerge(g)}>
                      Merge {g.duplicates.length} into “keep”
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" disabled={acting} onClick={() => onDismiss(g)}>
                      Not duplicates
                    </button>
                  </div>
                </div>
              ))}
              <div>
                <button type="button" className="btn btn--quiet btn--sm" onClick={onClearResults} disabled={acting}>
                  Clear all results
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* The active draft list (re-fetches on reloadToken after a merge/discard) */}
      <SignalFeed key="active" initial={active} status="unpublished" admin redirectTo="/signals/drafts" reloadToken={reloadToken} />
        </>
      )}
    </div>
  );
}

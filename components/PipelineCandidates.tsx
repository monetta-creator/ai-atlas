'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { overrideTriageAction, setCandidateArchivedAction } from '@/lib/actions';
import { SIGNAL_LENS_LABEL, SIGNAL_LENS_SLUGS } from '@/lib/format';
import type { SignalCandidate, SignalLens, TriageStatus } from '@/lib/types';

const STATUS_COLOR: Record<TriageStatus, string> = {
  pending: 'var(--faint-ink)',
  approved: 'var(--supports)',
  rejected: 'var(--heat-4)',
  duplicate: 'var(--heat-2)',
};

// "needs manual" is a derived view of rejected candidates the pipeline couldn't fetch.
const isUnanalyzable = (c: SignalCandidate) =>
  c.triage_status === 'rejected' && (c.triage_reason ?? '').startsWith('unanalyzable');

type StatusFilter = 'all' | TriageStatus | 'needs_manual' | 'archived';
const STATUS_OPTS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'needs_manual', label: 'Needs manual' },
  { value: 'archived', label: 'Archived' },
];

const PAGE_SIZES = [25, 50, 100] as const;

// Filterable, paginated candidate review for the latest run. The list can run to hundreds
// of rows, so it filters (status / lens / text) and pages in the client; the Approve/Reject
// overrides stay server actions (revalidate refreshes the data, state here persists).
export default function PipelineCandidates({
  candidates, runId,
}: { candidates: SignalCandidate[]; runId: string }) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [lens, setLens] = useState<'all' | SignalLens>('all');
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState<number>(50); // 0 = show all
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (lens !== 'all' && c.lens !== lens) return false;
      // Archived candidates are set aside: shown ONLY under the 'archived' filter, hidden everywhere else.
      const archived = !!c.archived_at;
      if (status === 'archived') {
        if (!archived) return false;
      } else if (archived) {
        return false;
      } else if (status === 'needs_manual') {
        if (!isUnanalyzable(c)) return false;
      } else if (status !== 'all' && c.triage_status !== status) {
        return false;
      }
      if (q) {
        const hay = `${c.headline ?? ''} ${c.source_domain ?? ''} ${c.url}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, status, lens, query]);

  const showAll = pageSize === 0;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = showAll ? 0 : (safePage - 1) * pageSize;
  const shown = showAll ? filtered : filtered.slice(start, start + pageSize);
  const reset = () => setPage(1);

  if (!candidates.length) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No candidates yet. Run discovery.</p>;
  }

  return (
    <>
      <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <div className="field" style={{ minWidth: 150 }}>
          <label htmlFor="cand-status">Status</label>
          <select
            id="cand-status" className="input" value={status}
            onChange={(e) => { setStatus(e.target.value as StatusFilter); reset(); }}
          >
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 150 }}>
          <label htmlFor="cand-lens">Lens</label>
          <select
            id="cand-lens" className="input" value={lens}
            onChange={(e) => { setLens(e.target.value as 'all' | SignalLens); reset(); }}
          >
            <option value="all">All lenses</option>
            {SIGNAL_LENS_SLUGS.map((l) => <option key={l} value={l}>{SIGNAL_LENS_LABEL[l]}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="cand-q">Search</label>
          <input
            id="cand-q" className="input" type="search" placeholder="headline, domain, url…"
            value={query} onChange={(e) => { setQuery(e.target.value); reset(); }}
          />
        </div>
        <div className="field" style={{ minWidth: 110 }}>
          <label htmlFor="cand-size">Per page</label>
          <select
            id="cand-size" className="input" value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); reset(); }}
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value={0}>All</option>
          </select>
        </div>
      </div>

      <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
        {filtered.length === candidates.length
          ? `${filtered.length} candidates`
          : `${filtered.length} of ${candidates.length} candidates`}
        {!showAll && filtered.length > 0 &&
          ` · showing ${start + 1}–${Math.min(start + pageSize, filtered.length)}`}
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No candidates match these filters.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((c) => (
            <div
              key={c.id}
              className="rounded-[var(--radius)] border p-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center flex-wrap gap-2 text-xs" style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {SIGNAL_LENS_LABEL[c.lens as SignalLens]}
                </span>
                <span style={{ color: STATUS_COLOR[c.triage_status], fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  · {c.triage_status}
                </span>
                {isUnanalyzable(c) && (
                  <span style={{ color: 'var(--heat-2)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    · needs manual
                  </span>
                )}
                {c.archived_at && (
                  <span style={{ color: 'var(--heat-against)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    · archived
                  </span>
                )}
                {c.source_domain && <span style={{ color: 'var(--faint-ink)' }}>· {c.source_domain}</span>}
              </div>
              <a
                href={c.url} target="_blank" rel="noopener noreferrer"
                className="text-sm hover:underline" style={{ color: 'var(--ink)' }}
              >
                {c.headline || c.url}
              </a>
              <div className="flex items-center flex-wrap gap-3 mt-2">
                {c.triage_reason && (
                  <span className="text-xs" style={{ color: 'var(--dim)' }}>{c.triage_reason}</span>
                )}
                <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                  {c.archived_at ? (
                    <form action={setCandidateArchivedAction}>
                      <input type="hidden" name="candidate_id" value={c.id} />
                      <input type="hidden" name="archived" value="0" />
                      <button type="submit" className="btn btn--quiet btn--sm">Unarchive</button>
                    </form>
                  ) : c.signal_id ? (
                    <Link href={`/signals/${c.signal_id}`} className="btn btn--quiet btn--sm">draft →</Link>
                  ) : (
                    <>
                      {c.triage_status === 'approved' ? (
                        <form action={overrideTriageAction}>
                          <input type="hidden" name="candidate_id" value={c.id} />
                          <input type="hidden" name="run_id" value={runId} />
                          <input type="hidden" name="status" value="rejected" />
                          <button type="submit" className="btn btn--quiet btn--sm">Reject</button>
                        </form>
                      ) : (
                        <form action={overrideTriageAction}>
                          <input type="hidden" name="candidate_id" value={c.id} />
                          <input type="hidden" name="run_id" value={runId} />
                          <input type="hidden" name="status" value="approved" />
                          <button type="submit" className="btn btn--quiet btn--sm">Approve</button>
                        </form>
                      )}
                      <form action={setCandidateArchivedAction}>
                        <input type="hidden" name="candidate_id" value={c.id} />
                        <input type="hidden" name="archived" value="1" />
                        <button type="submit" className="btn btn--quiet btn--sm">Archive</button>
                      </form>
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showAll && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3" style={{ marginTop: 14 }}>
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
    </>
  );
}

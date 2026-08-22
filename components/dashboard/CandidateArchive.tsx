'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type {
  CandidateArchiveResult, CandidateArchiveFilters, CandidateArchiveRow,
  SignalContext, TriageStatus,
} from '@/lib/types';
import { getCandidateArchiveAction } from '@/lib/actions';
import { SIGNAL_CONTEXT_SLUGS, SIGNAL_CONTEXT_LABEL, signalContextColor, dateLabel } from '@/lib/format';

// Section 3 — the browsable candidate archive. A dense audit trail over every discovered
// candidate. Filtering/search/pagination run through a public read server action so they
// don't re-render the rest of the (expensive) dashboard. First page arrives as `initial`.

const TRIAGE_OPTS: TriageStatus[] = ['pending', 'approved', 'rejected', 'duplicate'];
const TRIAGE_COLOR: Record<TriageStatus, string> = {
  approved: 'var(--supports)',
  rejected: 'var(--contradicts)',
  duplicate: 'var(--heat-2)',
  pending: 'var(--faint-ink)',
};

function host(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

export default function CandidateArchive({ initial, admin }: { initial: CandidateArchiveResult; admin: boolean }) {
  const [context, setContext] = useState<SignalContext | ''>('');
  const [status, setStatus] = useState<TriageStatus | ''>('');
  const [dateField, setDateField] = useState<'retrieved_at' | 'published_date'>('retrieved_at');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CandidateArchiveResult>(initial);
  const [pending, startTransition] = useTransition();
  const firstRender = useRef(true);

  // Debounce the search box; committing a new term resets to page 1.
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Re-fetch whenever a committed filter or the page changes. Skip the first render — the
  // server already handed us page 1 as `initial`.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const filters: CandidateArchiveFilters = {
      context: context || undefined,
      triage_status: status || undefined,
      dateField,
      from: from || undefined,
      to: to || undefined,
      search: debounced || undefined,
      page,
    };
    startTransition(async () => {
      const r = await getCandidateArchiveAction(filters);
      setResult(r);
    });
  }, [context, status, dateField, from, to, debounced, page]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const anyFilter = !!(context || status || from || to || search || dateField !== 'retrieved_at');

  function clearAll() {
    setContext(''); setStatus(''); setDateField('retrieved_at');
    setFrom(''); setTo(''); setSearch(''); setDebounced(''); setPage(1);
  }

  return (
    <div className="ls-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="lens-chip-row">
          {SIGNAL_CONTEXT_SLUGS.map((c) => {
            const on = context === c;
            const color = signalContextColor(c);
            return (
              <button
                key={c}
                type="button"
                className="lenschip"
                data-on={on ? '' : undefined}
                onClick={() => { setContext(on ? '' : c); setPage(1); }}
                style={on ? { color, borderColor: `color-mix(in oklab, ${color} 45%, var(--line))`, background: `color-mix(in oklab, ${color} 12%, var(--surface))` } : undefined}
              >
                {SIGNAL_CONTEXT_LABEL[c]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12.5 }}>
          <input
            className="input"
            placeholder="Search headline or URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13 }}
          />
          <select
            className="input"
            value={status}
            onChange={(e) => { setStatus(e.target.value as TriageStatus | ''); setPage(1); }}
            style={{ padding: '8px 12px', fontSize: 13 }}
            aria-label="Triage status"
          >
            <option value="">All triage states</option>
            {TRIAGE_OPTS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="input"
            value={dateField}
            onChange={(e) => { setDateField(e.target.value as 'retrieved_at' | 'published_date'); setPage(1); }}
            style={{ padding: '8px 12px', fontSize: 13 }}
            aria-label="Date field"
          >
            <option value="retrieved_at">Discovered</option>
            <option value="published_date">Published</option>
          </select>
          <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ padding: '7px 10px', fontSize: 13 }} aria-label="From date" />
          <span style={{ color: 'var(--faint-ink)' }}>→</span>
          <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ padding: '7px 10px', fontSize: 13 }} aria-label="To date" />
          {anyFilter && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll}>Clear</button>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          {result.total} candidate{result.total === 1 ? '' : 's'}{pending ? ' · loading…' : ''}
        </div>
      </div>

      {/* Rows */}
      {result.rows.length === 0 ? (
        <p className="ls-empty" style={{ margin: 0 }}>No candidates match these filters.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', opacity: pending ? 0.55 : 1, transition: 'opacity .15s' }}>
          {result.rows.map((row) => <ArchiveRow key={row.id} row={row} admin={admin} />)}
        </div>
      )}

      {/* Pagination */}
      {result.total > result.pageSize && (
        <div className="flex items-center justify-between gap-2" style={{ fontSize: 12.5 }}>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span style={{ color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>Page {page} of {totalPages}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function ArchiveRow({ row, admin }: { row: CandidateArchiveRow; admin: boolean }) {
  const contextColor = signalContextColor(row.context);
  const linkSignal = !!row.signal_id && (admin || row.signal_published === true);
  return (
    <div
      className="flex items-start gap-3"
      style={{ borderTop: '1px solid var(--line)', padding: '11px 0', minWidth: 0 }}
    >
      <span
        className="badge"
        title={row.triage_reason ?? undefined}
        style={{ fontSize: 10, padding: '2px 8px', color: TRIAGE_COLOR[row.triage_status], borderColor: `color-mix(in oklab, ${TRIAGE_COLOR[row.triage_status]} 38%, var(--line))`, flexShrink: 0, marginTop: 1 }}
      >
        {row.triage_status}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', color: 'var(--ink)', fontSize: 13.5, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={row.headline ?? row.url}
        >
          {row.headline || host(row.url)}
        </a>
        <span className="flex items-center gap-2 flex-wrap" style={{ marginTop: 3, fontSize: 11, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: contextColor }}>{SIGNAL_CONTEXT_LABEL[row.context]}</span>
          <span>· {row.source_domain || host(row.url)}</span>
          <span>· {dateLabel(row.retrieved_at)}</span>
          {row.analysis_status !== 'pending' && <span>· {row.analysis_status}</span>}
          {row.archived_at && <span style={{ color: 'var(--heat-against)' }}>· archived</span>}
          {linkSignal && (
            <Link href={`/signals/${row.signal_id}`} style={{ color: 'var(--accent)' }}>· signal →</Link>
          )}
        </span>
      </span>
    </div>
  );
}

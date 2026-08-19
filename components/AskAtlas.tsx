'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import type { SignalMap, ValidIdsPlain } from '@/lib/ask/verify';
import { renderAnswer } from '@/components/ask/answer';
import AskDatasetCard, { type DatasetSuggestionMeta } from '@/components/datasets/AskDatasetCard';

// The single-shot Ask widget (kept for the per-signal ask on /signals/[id];
// the full multi-turn workspace lives at /ask). Citation rendering is shared
// with the workspace via components/ask/answer.tsx.
//
// An answer may end with [dataset <slug>] suggestion tokens. They are verified
// against the registry list passed via the `datasets` prop (same discipline as
// record citations), stripped from the displayed prose, and rendered as a
// download card under the answer.
const DATASET_TOKEN = /\[dataset\s+([a-z0-9-]+)\]/gi;

type Status = 'idle' | 'streaming' | 'done' | 'error';

export default function AskAtlas({
  validIds,
  endpoint = '/api/ask',
  placeholder = 'Ask about the Atlas, for example: what is the evidence against the unit-economics bull case?',
  datasets,
}: {
  validIds: ValidIdsPlain;
  // The streaming endpoint to POST { query } to. Defaults to the whole-Atlas /api/ask; the
  // signal detail page points it at the per-signal scoped route.
  endpoint?: string;
  placeholder?: string;
  // Registry metadata for verifying [dataset <slug>] suggestions (portal Ask only).
  datasets?: DatasetSuggestionMeta[];
}) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [signalMap, setSignalMap] = useState<SignalMap>({});
  const [status, setStatus] = useState<Status>('idle');

  const streaming = status === 'streaming';

  async function ask() {
    const qq = query.trim();
    if (!qq || streaming) return;
    setAnswer('');
    setSignalMap({});
    setStatus('streaming');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: qq }),
      });
      if (!res.ok || !res.body) {
        setAnswer(res.status === 401 ? 'Your session has expired. Please log in again.' : 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      // Resolve [signal Sn] citations: tag -> signal uuid for this answer.
      const hdr = res.headers.get('X-Ask-Signals');
      if (hdr) {
        try { setSignalMap(JSON.parse(hdr) as SignalMap); } catch { /* leave empty */ }
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setAnswer(acc);
      }
      setStatus('done');
    } catch {
      setAnswer('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  // Extract verified dataset suggestions and strip their tokens from the prose;
  // unknown slugs stay visible so they read as (and get flagged like) prose.
  const suggested: string[] = [];
  let display = answer;
  if (datasets?.length) {
    display = answer.replace(DATASET_TOKEN, (m, slug: string) => {
      if (datasets.some((d) => d.slug === slug)) {
        if (!suggested.includes(slug)) suggested.push(slug);
        return '';
      }
      return m;
    }).replace(/\n{3,}$/, '\n');
  }

  const { nodes, unverified, readMore } = renderAnswer(display, validIds, signalMap);

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <textarea
        className="input"
        rows={3}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void ask();
          }
        }}
        style={{ resize: 'vertical', lineHeight: 1.5 }}
      />
      <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn--primary" onClick={() => void ask()} disabled={streaming || !query.trim()}>
          {streaming ? 'Asking…' : 'Ask'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          grounded in the database, cmd/ctrl + enter to send
        </span>
      </div>

      {(answer || streaming) && (
        <div
          style={{
            marginTop: 22,
            padding: '16px 18px',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            fontSize: 14.5,
            lineHeight: 1.65,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {nodes}
          {streaming && <span aria-hidden="true" style={{ color: 'var(--faint-ink)' }}>▍</span>}
        </div>
      )}

      {status === 'done' && suggested.length > 0 && datasets && (
        <AskDatasetCard slugs={suggested} datasets={datasets} />
      )}

      {status === 'done' && readMore.length > 0 && (
        <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--faint-ink)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--ink)' }}>Read more:</strong>{' '}
          {readMore.map((c, i) => (
            <Fragment key={`${c.kind}:${c.id}`}>
              {i > 0 && <span style={{ color: 'var(--line)' }}> · </span>}
              <Link
                href={c.href}
                prefetch={false}
                style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.95em', whiteSpace: 'nowrap' }}
              >
                {c.kind} {c.id}
              </Link>
            </Fragment>
          ))}
        </p>
      )}

      {status === 'done' && unverified > 0 && (
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--heat-4)' }}>
          {unverified} reference{unverified === 1 ? '' : 's'} could not be verified against the Atlas and {unverified === 1 ? 'is' : 'are'} flagged above.
        </p>
      )}
    </div>
  );
}

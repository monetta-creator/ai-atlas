'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// The document viewer inside the peek panel: the retained article text behind
// a signal, readable beside the answer for admin/portal readers (the API 401s
// everyone else). Highlighting is built as React nodes (never innerHTML): the
// question's terms match from a word boundary so "agent" also lights "agents",
// and any double-quoted spans from the answer match verbatim, so a quoted
// sentence in the answer can be found in the source in one tap.

export interface DocHighlight {
  terms: string[];
  phrases: string[];
}

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'while', 'with', 'would', 'could', 'should',
  'there', 'their', 'about', 'have', 'this', 'that', 'from', 'does', 'than',
  'then', 'them', 'they', 'these', 'those', 'been', 'being', 'were', 'will',
  'your', 'into', 'over', 'under', 'also', 'only', 'just', 'like', 'more',
  'most', 'some', 'such', 'very', 'each', 'other', 'between', 'after', 'before',
  'against', 'because', 'atlas', 'signal', 'signals', 'claim', 'claims', 'tell',
  'show', 'give', 'know', 'latest', 'recent',
]);

// Question words become prefix terms; double-quoted spans in the answer become
// exact phrases. Both feed one alternation, phrases first (longest first) so a
// quoted sentence wins over the words inside it.
export function buildHighlight(question: string, answer: string): DocHighlight {
  const terms: string[] = [];
  for (const w of question.toLowerCase().split(/[^a-z0-9']+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w) && !terms.includes(w)) terms.push(w);
    if (terms.length >= 12) break;
  }
  const phrases: string[] = [];
  const quoted = /["“”]([^"“”]{4,160})["“”]/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(answer)) && phrases.length < 8) {
    const p = m[1].trim();
    if (p && !phrases.includes(p)) phrases.push(p);
  }
  phrases.sort((a, b) => b.length - a.length);
  return { terms, phrases };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(h: DocHighlight): RegExp | null {
  const parts = [
    ...h.phrases.map(escapeRe),
    ...h.terms.map((t) => `\\b${escapeRe(t)}`),
  ];
  if (parts.length === 0) return null;
  return new RegExp(`(${parts.join('|')})`, 'gi');
}

const MARK_CAP = 400;

function segmentText(text: string, matcher: RegExp | null): { nodes: React.ReactNode[]; count: number } {
  if (!matcher) return { nodes: [text], count: 0 };
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let count = 0;
  let m: RegExpExecArray | null;
  matcher.lastIndex = 0;
  while ((m = matcher.exec(text)) && count < MARK_CAP) {
    if (m[0].length === 0) { matcher.lastIndex++; continue; }
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<mark key={count}>{m[0]}</mark>);
    last = m.index + m[0].length;
    count++;
  }
  nodes.push(text.slice(last));
  return { nodes, count };
}

interface DocPayload {
  title: string;
  published_on: string | null;
  outlet: string | null;
  source_url: string | null;
  chars: number;
  text: string;
}

export default function AskDoc({
  signalId, highlight, onBack, onClose,
}: {
  signalId: string;
  highlight: DocHighlight;
  onBack: () => void;
  onClose: () => void;
}) {
  // The AskPeek pattern: state carries the request key it belongs to, so a
  // stale result reads as loading and no setState runs synchronously in the
  // effect body (React Compiler rule). status 0 = network failure.
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; payload: DocPayload | null; status: number } | null>(null);
  const key = `${signalId}:${attempt}`;
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    fetch(`/api/ask/doc?signal=${encodeURIComponent(signalId)}`, { signal: ac.signal })
      .then(async (r) => {
        const payload = r.ok ? ((await r.json()) as DocPayload) : null;
        if (live) setResult({ key, payload, status: r.status });
      })
      .catch((e: Error) => { if (live && e.name !== 'AbortError') setResult({ key, payload: null, status: 0 }); });
    return () => { live = false; ac.abort(); };
  }, [key, signalId]);

  const current = result && result.key === key ? result : null;
  const data = current?.payload ?? null;

  const marked = useMemo(() => {
    if (!data) return { nodes: [] as React.ReactNode[], count: 0 };
    const text = data.text.replace(/\n{3,}/g, '\n\n');
    return segmentText(text, buildMatcher(highlight));
  }, [data, highlight]);

  function jumpToFirst() {
    textRef.current?.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return (
    <div className="ask-doc">
      <div className="ask-doc-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onBack}>
            ‹ Back to the record
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close record panel">
            ✕
          </button>
        </div>
        {data && (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>{data.title}</div>
            <div className="ask-doc-meta">
              {[data.outlet, data.published_on, `${Math.round(data.chars / 1000)}k chars retained`]
                .filter(Boolean).join(' · ')}
              {data.source_url && (
                <>
                  {' · '}
                  <a href={data.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    Open original ↗
                  </a>
                </>
              )}
            </div>
            {marked.count > 0 && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={jumpToFirst} style={{ alignSelf: 'flex-start' }}>
                {marked.count === 1 ? '1 match' : `${marked.count >= MARK_CAP ? `${MARK_CAP}+` : marked.count} matches`} · Jump to first
              </button>
            )}
          </>
        )}
      </div>

      {!current && (
        <p style={{ fontSize: 13, color: 'var(--faint-ink)' }}>Loading the retained text…</p>
      )}
      {current && !data && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--faint-ink)', marginBottom: 10 }}>
            {current.status === 401
              ? 'Your access has expired. Reload the page and unlock the workspace again.'
              : current.status === 404
                ? 'No retained text is held for this record. The original source link on the record is the way in.'
                : 'The text could not be loaded.'}
          </p>
          {current.status !== 401 && current.status !== 404 && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          )}
        </div>
      )}
      {data && (
        <div className="ask-doc-text" ref={textRef}>{marked.nodes}</div>
      )}
    </div>
  );
}

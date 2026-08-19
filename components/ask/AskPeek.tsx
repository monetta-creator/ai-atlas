'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PeekKind, PeekPayload } from '@/lib/ask/search';
import AskDoc, { type DocHighlight } from '@/components/ask/AskDoc';

// The citation peek: the cited record beside the conversation. The panel leans
// OUTWARD for guests: the primary CTA is the original source, with the Atlas
// page secondary. Admin and portal readers additionally get the document
// viewer (AskDoc): the retained article text opens in place of the peek body,
// with the question's terms highlighted. One instance serves both layouts: a
// grid column on desktop, a right sheet on mobile (CSS decides; see the
// .ask-peek media block).

const DIR_GLYPH: Record<string, { glyph: string; color: string }> = {
  supports: { glyph: '+', color: 'var(--supports)' },
  contradicts: { glyph: '−', color: 'var(--contradicts)' },
  neutral: { glyph: '·', color: 'var(--faint-ink)' },
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="lbl" style={{ fontSize: 9.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--dim)', whiteSpace: 'pre-wrap' }}>{children}</div>
    </div>
  );
}

export default function AskPeek({
  peek, onClose, canReadDoc, docOpen, onDocOpen, highlight,
}: {
  peek: { kind: PeekKind; id: string };
  onClose: () => void;
  canReadDoc: boolean;
  docOpen: boolean;
  onDocOpen: (open: boolean) => void;
  highlight: DocHighlight;
}) {
  // Loading is DERIVED, not set: state carries the request key it belongs to,
  // so a stale result reads as loading and no setState runs synchronously in
  // the effect body (React Compiler rule).
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; payload: PeekPayload | null; failed: boolean } | null>(null);
  const key = `${peek.kind}:${peek.id}:${attempt}`;

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    fetch(`/api/ask/peek?kind=${encodeURIComponent(peek.kind)}&id=${encodeURIComponent(peek.id)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((payload: PeekPayload) => { if (live) setResult({ key, payload, failed: false }); })
      .catch((e: Error) => { if (live && e.name !== 'AbortError') setResult({ key, payload: null, failed: true }); });
    return () => { live = false; ac.abort(); };
  }, [key, peek.kind, peek.id]);

  const current = result && result.key === key ? result : null;
  const data = current?.payload ?? null;
  const status: 'loading' | 'error' | 'done' = !current ? 'loading' : current.failed ? 'error' : 'done';

  if (docOpen && peek.kind === 'signal') {
    return (
      <div className="ask-peek">
        <AskDoc
          signalId={peek.id}
          highlight={highlight}
          onBack={() => onDocOpen(false)}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <div className="ask-peek">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="lbl" style={{ fontSize: 9.5 }}>{data?.subtitle ?? 'Record'}</span>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={onClose}
          aria-label="Close record panel"
        >
          ✕
        </button>
      </div>

      {status === 'loading' && (
        <p style={{ fontSize: 13, color: 'var(--faint-ink)' }}>Loading record…</p>
      )}
      {status === 'error' && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--faint-ink)', marginBottom: 10 }}>
            The record could not be loaded.
          </p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === 'done' && data && (
        <>
          <h3 style={{ fontSize: 16.5, lineHeight: 1.45, margin: 0 }}>
            {data.code ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginRight: 8 }}>{data.code}</span> : null}
            {data.title}
          </h3>

          {data.kind === 'signal' && data.source?.url && (
            <div>
              <a
                className="btn btn--primary"
                style={{ display: 'block', textAlign: 'center' }}
                href={data.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original source ↗
              </a>
              <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', textAlign: 'center', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                {[data.source.outlet ?? data.source.title, data.source.published_on].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {data.kind === 'signal' && canReadDoc && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ width: '100%', textAlign: 'center' }}
              onClick={() => onDocOpen(true)}
            >
              Read the retained text
            </button>
          )}

          {data.kind === 'paper' && data.source?.url && (
            <div>
              <a
                className="btn btn--primary"
                style={{ display: 'block', textAlign: 'center' }}
                href={data.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the paper ↗
              </a>
              <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', textAlign: 'center', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                {[data.source.title, data.source.published_on].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {data.body && <Section label="Summary">{data.body}</Section>}
          {data.finding.map((f) => (
            <Section key={f.label} label={f.label}>{f.value}</Section>
          ))}
          {data.brief?.what_happened && <Section label="What happened">{data.brief.what_happened}</Section>}
          {data.brief?.why_it_matters && <Section label="Why it matters">{data.brief.why_it_matters}</Section>}
          {data.brief?.whats_contested && <Section label="What is contested">{data.brief.whats_contested}</Section>}
          {data.counterpoint && <Section label="The other read">{data.counterpoint}</Section>}
          {data.test && (
            <Section label={data.kind === 'stance' ? 'What would move off it' : 'Falsifying test'}>
              {data.test}
            </Section>
          )}

          {data.evidence.length > 0 && (
            <div>
              <div className="lbl" style={{ fontSize: 9.5, marginBottom: 8 }}>Evidence</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.evidence.map((e, i) => {
                  const d = DIR_GLYPH[e.direction] ?? DIR_GLYPH.neutral;
                  return (
                    <div key={i} style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--dim)' }}>
                      <span style={{ color: d.color, fontFamily: 'var(--font-mono)', marginRight: 6 }}>{d.glyph}</span>
                      {e.excerpt}
                      {e.source_url && (
                        <>
                          {' '}
                          <a
                            href={e.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--accent)', fontSize: 11.5, whiteSpace: 'nowrap' }}
                          >
                            {e.outlet ?? 'source'} ↗
                          </a>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.signals.length > 0 && (
            <div>
              <div className="lbl" style={{ fontSize: 9.5, marginBottom: 8 }}>Touching signals</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.signals.map((s) => (
                  <Link key={s.id} href={`/signals/${s.id}`} prefetch={false} style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none', lineHeight: 1.5 }}>
                    {s.title}{s.published_on ? ` (${s.published_on})` : ''}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.members.length > 0 && (
            <div>
              <div className="lbl" style={{ fontSize: 9.5, marginBottom: 8 }}>Papers in this thread</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.members.map((m) => (
                  <Link key={m.id} href={`/research/${m.id}`} prefetch={false} style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none', lineHeight: 1.5 }}>
                    {m.title}{m.relation ? ` (${m.relation})` : ''}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.stances.length > 0 && (
            <Section label="Stances">
              {data.stances.map((s) => `${s.code}: ${s.title}`).join('\n')}
            </Section>
          )}
          {data.prerequisites.length > 0 && (
            <Section label="Understand first">
              {data.prerequisites.map((c) => c.name).join(', ')}
            </Section>
          )}
          {data.builds_toward.length > 0 && (
            <Section label="Builds toward">
              {data.builds_toward.map((c) => c.name).join(', ')}
            </Section>
          )}

          <Link
            className={data.kind === 'signal' && data.source?.url ? 'btn btn--ghost btn--sm' : 'btn btn--primary btn--sm'}
            style={{ textAlign: 'center' }}
            href={data.internal}
            prefetch={false}
          >
            Open in the Atlas
          </Link>
        </>
      )}
    </div>
  );
}

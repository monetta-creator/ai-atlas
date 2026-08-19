'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DOMAIN_LABEL, dateLabel } from '@/lib/format';
import type { ArgumentGapScan, ArgumentGapRecommendation } from '@/lib/types';

const relLabel = (r: string) => (r === 'depends_on' ? 'depends on' : r);

function draftHref(r: ArgumentGapRecommendation, thesisId?: string): string {
  const thesisParam = thesisId ? `&thesis=${encodeURIComponent(thesisId)}` : '';
  return r.kind === 'bridge'
    ? `/bridge/new?gap=${encodeURIComponent(r.code)}${thesisParam}`
    : `/q/${r.question_slug}/claim/new?gap=${encodeURIComponent(r.code)}${thesisParam}`;
}

// Admin-only gap-diagnosis panel with two homes: the map-wide scan on /map and
// the per-thesis scan on /theses/[id]. The three server actions arrive as PROPS
// (bind the thesis id in the server page), so one component serves both scans.
// Recommend-only — "Start draft" opens the authoring form pre-filled from the
// persisted scan; nothing here writes.
export default function ArgumentGapPanel({
  initial, diagnose, dismiss: dismissAction, clear, thesisId, title, explainer, emptyCopy,
}: {
  initial: ArgumentGapScan | null;
  diagnose: () => Promise<ArgumentGapScan>;
  dismiss: (code: string) => Promise<void>;
  clear: () => Promise<void>;
  thesisId?: string;
  title?: string;
  explainer?: string;
  emptyCopy?: string;
}) {
  const [scan, setScan] = useState<ArgumentGapScan | null>(initial);
  const [busy, setBusy] = useState(false);
  const [ranEmpty, setRanEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setRanEmpty(false);
    try {
      const result = await diagnose();
      setScan(result.recommendations.length ? result : null);
      setRanEmpty(result.recommendations.length === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnosis failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(code: string) {
    setScan((prev) => {
      if (!prev) return prev;
      const recommendations = prev.recommendations.filter((r) => r.code !== code);
      return recommendations.length ? { ...prev, recommendations } : null;
    });
    try {
      await dismissAction(code);
    } catch {
      // worst case the rec reappears on refresh — the scan is the source of truth
    }
  }

  async function clearAll() {
    setScan(null);
    setRanEmpty(false);
    try {
      await clear();
    } catch {}
  }

  return (
    <div className="gap-panel">
      <div className="gap-panel-head">
        <div>
          <span className="section-label" style={{ margin: 0 }}>{title ?? 'Gap diagnosis'}</span>
          <p className="gap-panel-sub">
            {explainer ??
              'The model reads recent reports and signals against the map and argues for the few claims or bridges recent evidence demands. It cites its grounding, and recommending nothing is a normal outcome. Nothing is created until you submit the form.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scan && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll} disabled={busy}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={run} disabled={busy}>
            {busy ? 'Diagnosing…' : scan ? '✦ Re-run diagnosis' : '✦ Diagnose gaps'}
          </button>
        </div>
      </div>

      {error && <p className="editable-error">{error}</p>}
      {ranEmpty && !scan && (
        <p className="gap-empty">
          {emptyCopy ?? 'No gaps. The map already covers what recent reports and signals surface.'}
        </p>
      )}

      {scan && (
        <>
          <p className="gap-meta">
            Scanned {dateLabel(scan.generatedAt) ?? scan.generatedAt} ·{' '}
            {scan.recommendations.length} recommendation{scan.recommendations.length === 1 ? '' : 's'}.
            Persists until cleared, dismissed, or re-run.
          </p>
          <div className="gap-list">
            {scan.recommendations.map((r) => (
              <div key={r.code} className="gap-rec">
                <div className="gap-rec-head">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="gap-kind" data-kind={r.kind}>{r.kind === 'bridge' ? 'bridge-claim' : 'claim'}</span>
                    <span className="gap-slug">{r.code}</span>
                    <span className="gap-slug">
                      {r.kind === 'bridge'
                        ? `${DOMAIN_LABEL[r.domain_from!]} → ${DOMAIN_LABEL[r.domain_to!]}`
                        : DOMAIN_LABEL[r.domain!]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={draftHref(r, thesisId)} className="btn btn--primary btn--sm">Start draft</Link>
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => dismiss(r.code)}>
                      Dismiss
                    </button>
                  </div>
                </div>

                <p className="gap-def" style={{ color: 'var(--ink)', fontWeight: 560 }}>{r.statement}</p>
                <p className="gap-def"><span className="gap-argument-label">test</span> {r.test}</p>
                <p className="gap-argument">
                  <span className="gap-argument-label">why</span> {r.argument}
                </p>

                {/* grounding: the evidence that motivates this, with Read more links */}
                <p className="gap-def" style={{ fontStyle: 'italic' }}>
                  <span className="gap-argument-label">grounded in</span> {r.grounding.finding}
                </p>
                {(r.grounding.report_id || r.grounding.signal_ids.length > 0) && (
                  <div className="gap-wiring">
                    <span>
                      Read more:{' '}
                      {r.grounding.report_id && (
                        <Link href={`/reports/${r.grounding.report_id}`} className="gap-chip">
                          {r.grounding.report_title || 'report'}
                        </Link>
                      )}
                      {r.grounding.signal_ids.map((id, i) => (
                        <span key={id}>
                          {(i > 0 || r.grounding.report_id) && ', '}
                          <Link href={`/signals/${id}`} className="gap-chip">signal {i + 1}</Link>
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {r.edges.length > 0 && (
                  <div className="gap-wiring">
                    <span>
                      {r.kind === 'bridge' ? 'fed by:' : 'bears on:'}{' '}
                      {r.edges.map((e, i) => (
                        <span key={e.code}>
                          {i > 0 && ', '}
                          <span className="gap-chip">{e.code}</span>{' '}
                          <span style={{ color: 'var(--faint-ink)' }}>({relLabel(e.relation)})</span>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

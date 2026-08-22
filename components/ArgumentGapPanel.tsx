'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dateLabel, RESOLVABILITY_LABEL } from '@/lib/format';
import { createHypothesisAction } from '@/lib/actions';
import type { ArgumentGapScan, ArgumentGapRecommendation } from '@/lib/types';

// Admin-only gap-diagnosis panel with two homes: the atlas-wide scan on /map and
// the per-hypothesis scan on /hypothesis/[code]. The three server actions arrive
// as PROPS (bind the hypothesis id in the server page), so one component serves
// both scans. Recommend-only — "Create hypothesis" is an explicit form submit
// that commits the proposed statement/test through the normal create action
// (which also consumes the rec from the persisted scan); Dismiss discards it.
export default function ArgumentGapPanel({
  initial, diagnose, dismiss: dismissAction, clear, hypothesisId, title, explainer, emptyCopy,
}: {
  initial: ArgumentGapScan | null;
  diagnose: () => Promise<ArgumentGapScan>;
  dismiss: (code: string) => Promise<void>;
  clear: () => Promise<void>;
  hypothesisId?: string;
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
    } catch {
      // worst case the cleared scan reappears on refresh — the scan is the source of truth
    }
  }

  const createForm = (r: ArgumentGapRecommendation) => (
    <form action={createHypothesisAction} style={{ display: 'inline' }}>
      <input type="hidden" name="statement" value={r.statement} />
      <input type="hidden" name="test" value={r.test} />
      {r.resolvability && <input type="hidden" name="resolvability" value={r.resolvability} />}
      <input type="hidden" name="gap_code" value={r.code} />
      {hypothesisId && <input type="hidden" name="from_hypothesis_id" value={hypothesisId} />}
      <button type="submit" className="btn btn--primary btn--sm">Create hypothesis</button>
    </form>
  );

  return (
    <div className="gap-panel">
      <div className="gap-panel-head">
        <div>
          <span className="section-label" style={{ margin: 0 }}>{title ?? 'Gap diagnosis'}</span>
          <p className="gap-panel-sub">
            {explainer ??
              'The model reads recent reports and signals against the board and argues for the few hypotheses recent evidence demands. It cites its grounding, and recommending nothing is a normal outcome. Nothing is created until you commit a recommendation.'}
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
          {emptyCopy ?? 'No gaps. The board already covers what recent reports and signals surface.'}
        </p>
      )}

      {scan && (
        <>
          <p className="gap-meta">
            Scanned {dateLabel(scan.generatedAt) ?? scan.generatedAt} ·{' '}
            {scan.recommendations.length} recommendation{scan.recommendations.length === 1 ? '' : 's'}.
            Persists until cleared, dismissed, or created.
          </p>
          <div className="gap-list">
            {scan.recommendations.map((r) => (
              <div key={r.code} className="gap-rec">
                <div className="gap-rec-head">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="gap-kind">hypothesis</span>
                    <span className="gap-slug">{r.code}</span>
                    {r.resolvability && (
                      <span className="gap-slug">{RESOLVABILITY_LABEL[r.resolvability]} to resolve</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {createForm(r)}
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

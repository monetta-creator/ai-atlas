'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  diagnoseConceptGapsAction, dismissConceptGapAction, clearConceptGapScanAction,
} from '@/lib/actions';
import { CONCEPT_STATUS_LABEL, dateLabel } from '@/lib/format';
import type { ConceptGapScan } from '@/lib/types';

// Admin-only panel on /concepts: one model call argues for concepts the scaffold
// is missing (read against the Argument Map). Recommend-only — "Start draft" opens
// the create form pre-filled from the persisted scan; nothing here writes a concept.
export default function ConceptGapPanel({ initial }: { initial: ConceptGapScan | null }) {
  const [scan, setScan] = useState<ConceptGapScan | null>(initial);
  const [busy, setBusy] = useState(false);
  const [ranEmpty, setRanEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setRanEmpty(false);
    try {
      const result = await diagnoseConceptGapsAction();
      setScan(result.recommendations.length ? result : null);
      setRanEmpty(result.recommendations.length === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnosis failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(slug: string) {
    // Optimistic: drop locally, persist the removal server-side.
    setScan((prev) => {
      if (!prev) return prev;
      const recommendations = prev.recommendations.filter((r) => r.slug !== slug);
      return recommendations.length ? { ...prev, recommendations } : null;
    });
    try {
      await dismissConceptGapAction(slug);
    } catch {
      // worst case the rec reappears on refresh — the scan is the source of truth
    }
  }

  async function clearAll() {
    setScan(null);
    setRanEmpty(false);
    try {
      await clearConceptGapScanAction();
    } catch {}
  }

  return (
    <div className="gap-panel">
      <div className="gap-panel-head">
        <div>
          <span className="section-label" style={{ margin: 0 }}>Gap diagnosis</span>
          <p className="gap-panel-sub">
            The model reads the scaffold against the Argument Map and argues for missing
            concepts. You judge each argument. Nothing is created until you submit the form.
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
        <p className="gap-empty">No gaps found: the scaffold covers what the map currently leans on.</p>
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
              <div key={r.slug} className="gap-rec">
                <div className="gap-rec-head">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <strong>{r.name}</strong>
                    <span className="concept-tip-status" data-status={r.status}>
                      {CONCEPT_STATUS_LABEL[r.status]}
                    </span>
                    <span className="gap-slug">{r.slug}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/concepts/new?gap=${encodeURIComponent(r.slug)}`} className="btn btn--primary btn--sm">
                      Start draft
                    </Link>
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => dismiss(r.slug)}>
                      Dismiss
                    </button>
                  </div>
                </div>
                <p className="gap-def">{r.short_definition}</p>
                <p className="gap-argument">
                  <span className="gap-argument-label">why</span> {r.argument}
                </p>
                {(r.prerequisite_slugs.length > 0 || r.claim_codes.length > 0) && (
                  <div className="gap-wiring">
                    {r.prerequisite_slugs.length > 0 && (
                      <span>
                        needs:{' '}
                        {r.prerequisite_slugs.map((s, i) => (
                          <span key={s}>
                            {i > 0 && ', '}
                            <Link href={`/concepts/${s}`} className="gap-chip">{s}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                    {r.claim_codes.length > 0 && (
                      <span>
                        leaned on by:{' '}
                        {r.claim_codes.map((c, i) => (
                          <span key={c}>
                            {i > 0 && ', '}
                            <span className="gap-chip">{c}</span>
                          </span>
                        ))}
                      </span>
                    )}
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

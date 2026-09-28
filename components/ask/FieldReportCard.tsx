'use client';

import { useState } from 'react';
import type { FieldReportCard as FieldReportCardData, ProvenanceShare } from '@/lib/field-report/core';
import { publishFieldReportAction } from '@/lib/actions';

const PROV_LABEL: Record<keyof ProvenanceShare, string> = {
  atlas: 'Atlas records', web: 'Web sources', mixed: 'Mixed', analysis: 'Analysis',
};
const PROV_ORDER: (keyof ProvenanceShare)[] = ['atlas', 'web', 'mixed', 'analysis'];

function fmtUsd(usd: number): string {
  return usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

// The finished report, in the thread (2026-09-28): title, summary bullets, a
// provenance bar (how much of the report is Atlas records vs. web sources vs.
// both vs. the Atlas's own analysis, per lib/field-report/core's
// provenanceShare), Open/PDF, and, for admin, the publish gate (a keyholder's
// report is a draft until admin publishes it to every keyholder). Mirrors the
// publish button pattern from app/reports/sheet/[id]/SheetActions.tsx.
export default function FieldReportCard({
  report, admin, onPublishedChange,
}: {
  report: FieldReportCardData;
  admin: boolean;
  onPublishedChange?: (isPublished: boolean) => void;
}) {
  const [published, setPublished] = useState(report.isPublished);
  const [busy, setBusy] = useState(false);

  const total = PROV_ORDER.reduce((n, k) => n + report.provenance[k], 0) || 1;

  async function togglePublish() {
    const next = !published;
    setBusy(true);
    try {
      await publishFieldReportAction(report.id, next);
      setPublished(next);
      onPublishedChange?.(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fr-card fr-done">
      <p className="fr-kicker">FIELD REPORT · {report.size === 'full' ? 'FULL' : 'BRIEF'}</p>
      <h3 className="fr-title">{report.title}</h3>

      {report.summary.length > 0 && (
        <ul className="fr-summary">
          {report.summary.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}

      <div className="fr-prov-bar" role="img" aria-label="How this report's paragraphs are sourced">
        {PROV_ORDER.map((k) => {
          const pct = (report.provenance[k] / total) * 100;
          return pct > 0 ? <span key={k} className="fr-prov-seg" data-kind={k} style={{ width: `${pct}%` }} /> : null;
        })}
      </div>
      <div className="fr-prov-legend">
        {PROV_ORDER.filter((k) => report.provenance[k] > 0).map((k) => (
          <span key={k} className="fr-prov-legend-item">
            <span className="fr-prov-dot" data-kind={k} aria-hidden="true" />
            {PROV_LABEL[k]}
          </span>
        ))}
      </div>

      <div className="fr-actions">
        <a href={report.href} className="btn btn--primary btn--sm">Open report</a>
        <a href={report.pdfHref} className="btn btn--ghost btn--sm">PDF</a>
        {admin && (
          <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void togglePublish()}>
            {published ? 'Unpublish' : 'Publish'}
          </button>
        )}
        <span className="fr-cost">{fmtUsd(report.costUsd)}</span>
      </div>
    </div>
  );
}

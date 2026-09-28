import Link from 'next/link';
import type { Metadata } from 'next';
import { getPortalIdentity } from '@/lib/portal/identity';
import { jobViewerFor } from '@/lib/jobs/core';
import { listFieldReports } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import { descriptionFor } from '@/lib/page-info';
import PageTop from '@/components/PageTop';

// The Field Report index: a keyholder's own runs plus every published one,
// newest first; admin sees every run. A guest gets the keyholders-only
// plate, never the list (Field Report drafts are never guest-visible, even
// once published, the same rule lib/data/field-reports.ts enforces on the
// direct-by-id read).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Field Reports · The AI Atlas', description: descriptionFor('/field-reports') };

function LockPlate() {
  return (
    <div className="frv-wrap">
      <div className="plate frv-lockplate">
        <p className="frv-lock-head">Read with an access key</p>
        <p className="frv-lock-body">
          Field Report is Ask&rsquo;s research-report mode: a person asks, the Atlas drafts an editable plan,
          researches the Atlas records first, then the web for gaps, and writes a labeled, cited report. Reading one
          needs an access key or the admin password.
        </p>
        <div className="frv-lock-actions">
          <Link href="/datasets/request" className="btn btn--primary btn--sm">Request an access key</Link>
          <Link href="/reports" className="btn btn--quiet btn--sm">Report Portal</Link>
        </div>
      </div>
    </div>
  );
}

export default async function FieldReportsIndexPage() {
  const identity = await getPortalIdentity();
  const viewer = jobViewerFor(identity);
  const pageTopViewer = { admin: viewer.admin, portal: !!viewer.keyId };

  if (!viewer.admin && !viewer.keyId) {
    return (
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop pathname="/field-reports" label="Field Reports" viewer={{ admin: false, portal: false }} infoKey="/field-reports" />
        <LockPlate />
      </section>
    );
  }

  const reports = await listFieldReports(viewer, 100);

  return (
    <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
      <PageTop pathname="/field-reports" label="Field Reports" viewer={pageTopViewer} infoKey="/field-reports" />

      {reports.length === 0 ? (
        <p className="frv-empty">No Field Reports yet. Start one from /ask.</p>
      ) : (
        <ul className="frv-index">
          {reports.map((r) => (
            <li key={r.id} className="frv-index-row">
              <div className="frv-index-main">
                <Link href={`/field-reports/${r.id}`} className="frv-index-title">{r.title}</Link>
                <p className="frv-index-question">{r.question}</p>
                <p className="frv-index-meta">
                  {r.size === 'full' ? 'Full' : 'Brief'} &middot; {dateLabel(r.generated_at) ?? r.generated_at.slice(0, 10)}
                  {r.costUsd > 0 && <> &middot; ${r.costUsd.toFixed(2)}</>}
                  {' '}&middot;{' '}
                  <span data-published={r.is_published || undefined}>{r.is_published ? 'Published' : 'Draft'}</span>
                  {!r.is_published && r.created_by && <> ({r.created_by === 'admin' ? 'admin' : 'yours'})</>}
                </p>
              </div>
              <div className="frv-index-actions">
                <Link href={`/field-reports/${r.id}`} className="btn btn--quiet btn--sm">Open</Link>
                <a href={`/field-reports/${r.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

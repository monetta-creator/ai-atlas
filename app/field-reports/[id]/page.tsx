import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPortalIdentity } from '@/lib/portal/identity';
import { jobViewerFor } from '@/lib/jobs/core';
import { getFieldReport } from '@/lib/data';
import { descriptionFor } from '@/lib/page-info';
import PageTop from '@/components/PageTop';
import FieldReportView from '@/components/field-report/FieldReportView';

// One Field Report. Access is stricter than the rest of the Report Portal:
// a keyholder reads their own drafts plus the published shelf, admin reads
// any, a guest reads NOTHING, published or not (lib/data/field-reports.ts
// getFieldReport enforces this; here we also never reveal the title to a
// guest, the same discipline app/savant/record/page.tsx uses for its
// keyholders-only plate).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Field Report · The AI Atlas', description: descriptionFor('/field-reports/[id]') };

const UUID_RE = /^[0-9a-f-]{36}$/i;

function LockPlate() {
  return (
    <div className="frv-wrap">
      <div className="plate frv-lockplate">
        <p className="frv-lock-head">Read with an access key</p>
        <p className="frv-lock-body">
          Field Reports are drafted for a specific person and published only when the admin decides to share them
          more widely, so this one needs an access key or the admin password. Request one, or see what else the
          Report Portal has published without a key.
        </p>
        <div className="frv-lock-actions">
          <Link href="/datasets/request" className="btn btn--primary btn--sm">Request an access key</Link>
          <Link href="/reports" className="btn btn--quiet btn--sm">Report Portal</Link>
        </div>
      </div>
    </div>
  );
}

export default async function FieldReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getPortalIdentity();
  const viewer = jobViewerFor(identity);

  if (!viewer.admin && !viewer.keyId) {
    return (
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop pathname="/field-reports" label="Field Report" title={null} viewer={{ admin: false, portal: false }} infoKey="/field-reports/[id]" />
        <LockPlate />
      </section>
    );
  }

  if (!UUID_RE.test(id)) notFound();
  const saved = await getFieldReport(id, viewer);
  if (!saved) notFound();

  return (
    <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
      <PageTop
        pathname="/field-reports"
        label="Field Report"
        title={null}
        viewer={{ admin: viewer.admin, portal: !!viewer.keyId }}
        infoKey="/field-reports/[id]"
      />
      <FieldReportView saved={saved} admin={viewer.admin} />
    </section>
  );
}

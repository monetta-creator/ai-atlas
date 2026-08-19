import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getSavedReport } from '@/lib/data';
import { sanitizeReportNarrative } from '@/lib/sanitize';
import Header from '@/components/Header';
import ReportReadView from '@/components/ReportReadView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report · The AI Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Public, read-only view of a saved report (the blotter links to the latest). The admin
// generator/editor lives in the portal at /reports/period. HTML is re-sanitized before render.
export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [admin, row] = await Promise.all([isAdmin(), getSavedReport(id)]);
  if (!row) notFound();
  const report = sanitizeReportNarrative(row.report);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 14 }}>
          <a href={`/reports/${row.id}/pdf`} className="btn btn--ghost btn--sm">Download PDF</a>
        </div>
        <ReportReadView title={row.title} report={report} />
      </section>
    </>
  );
}

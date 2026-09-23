import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getThesisReport } from '@/lib/data';
import { gateThesisNarrative } from '@/lib/thesis/citations';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';
import ThesisReportView from '@/components/ThesisReportView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Thesis report · The AI Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Public, read-only view of a saved thesis report (the share link the /theses
// console mints). Like /reports/[id]: no session required (proxy allow-list), no
// public index. The narrative is re-gated against the frozen pack before render,
// so even a tampered row could never link outside its own evidence.
export default async function ThesisReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [admin, row] = await Promise.all([isAdmin(), getThesisReport(id)]);
  if (!row) notFound();
  const report = { ...row, narrative: gateThesisNarrative(row.narrative, row.pack) };
  const when = dateLabel(report.generated_at) ?? report.generated_at.slice(0, 10);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop
          pathname={`/thesis-report/${report.id}`}
          label={report.title.length > 60 ? `${report.title.slice(0, 60)}…` : report.title}
          viewer={{ admin, portal: admin }}
          infoKey="/thesis-report/[id]"
          compact
          title={<h1>{report.title}</h1>}
          action={
            <a href={`/thesis-report/${report.id}/pdf`} className="btn btn--primary btn--sm">
              Download the PDF
            </a>
          }
        >
          generated {when} · grounded only in the Atlas&apos;s tracked signals
        </PageTop>

        <p style={{ margin: '0 0 18px', fontSize: 15, color: 'var(--dim)' }}>
          Thesis: <span style={{ color: 'var(--ink)' }}>{report.statement}</span>
        </p>

        <ThesisReportView report={report} />
      </section>
    </>
  );
}

import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getThesisReport } from '@/lib/data';
import { gateThesisNarrative } from '@/lib/thesis/citations';
import Header from '@/components/Header';
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

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingTop: 24, paddingBottom: 100 }}>
        <ThesisReportView report={report} />
      </section>
    </>
  );
}

import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getHypothesisReport } from '@/lib/data';
import { gateHypothesisNarrative } from '@/lib/hypothesis/citations';
import Header from '@/components/Header';
import HypothesisReportView from '@/components/HypothesisReportView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hypothesis report · The Strategy Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Public, read-only view of a saved hypothesis report (the share link the
// hypothesis console mints). Like /reports/[id]: no session required (proxy
// allow-list), no public index. The narrative is re-gated against the frozen
// pack before render, so even a tampered row could never link outside its own
// evidence.
export default async function HypothesisReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [admin, row] = await Promise.all([isAdmin(), getHypothesisReport(id)]);
  if (!row) notFound();
  const report = { ...row, narrative: gateHypothesisNarrative(row.narrative, row.pack) };

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingTop: 24, paddingBottom: 100 }}>
        <HypothesisReportView report={report} />
      </section>
    </>
  );
}

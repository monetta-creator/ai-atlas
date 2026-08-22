import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import { listSavedReports, getLatestHypothesisReports } from '@/lib/data';
import { formatDateRange, dateLabel } from '@/lib/format';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report Portal · The Strategy Atlas' };

// The Report Portal: the published shelf. Guests see period reports and
// hypothesis reports, each with its branded PDF download; the period-report
// generator is the admin console at /reports/period.
export default async function ReportPortal() {
  const admin = await isAdmin();
  const [reports, hypothesisReports] = await Promise.all([
    listSavedReports(),
    getLatestHypothesisReports(20),
  ]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 26 }}>
          <h1>Report Portal</h1>
          <p className="lede">
            Grounded reports from the Atlas corpus at period and hypothesis
            granularity: cited, synthesized, and downloadable as branded PDFs.
          </p>
        </header>

        {admin && (
          <div style={{ marginBottom: 34 }}>
            <div className="section-label">Generate a report</div>
            <div className="flex flex-wrap gap-3">
              <Link href="/reports/period" className="btn btn--ghost">Period report generator</Link>
              <Link href="/map" className="btn btn--ghost">Hypothesis reports · from a hypothesis page</Link>
            </div>
          </div>
        )}

        <div className="section-label">Period reports · {reports.length}</div>
        {reports.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No saved reports yet.</p>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {reports.map((r) => (
              <div key={r.id} className="plate flex items-baseline gap-3 flex-wrap">
                <Link href={`/reports/${r.id}`} className="hover:underline"
                  style={{ fontWeight: 600, fontSize: 15.5, color: 'var(--ink)', flex: 1, minWidth: 260 }}>
                  {r.title}
                </Link>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {formatDateRange(r.date_from, r.date_to)}
                  {r.contexts.length > 0 ? ` · ${r.contexts.length} context${r.contexts.length === 1 ? '' : 's'}` : ''}
                  {dateLabel(r.updated_at) ? ` · saved ${dateLabel(r.updated_at)}` : ''}
                </span>
                <a href={`/reports/${r.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
              </div>
            ))}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 28 }}>Hypothesis reports · {hypothesisReports.length}</div>
        {hypothesisReports.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No hypothesis reports yet.</p>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {hypothesisReports.map((t) => (
              <div key={t.report_id} className="plate flex items-baseline gap-3 flex-wrap">
                <Link href={`/hypothesis-report/${t.report_id}`} className="hover:underline"
                  style={{ fontWeight: 600, fontSize: 15.5, color: 'var(--ink)', flex: 1, minWidth: 260 }}>
                  {t.statement}
                </Link>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {t.matched} matched · {t.supports}s / {t.contradicts}c
                  {dateLabel(t.generated_at) ? ` · ${dateLabel(t.generated_at)}` : ''}
                </span>
                <a href={`/hypothesis-report/${t.report_id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
              </div>
            ))}
          </div>
        )}

      </section>
    </>
  );
}

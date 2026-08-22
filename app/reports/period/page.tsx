import { requireAdminPage } from '@/lib/auth';
import { buildReportData } from '@/lib/report';
import { listSavedReports } from '@/lib/data';
import { SIGNAL_CONTEXT_SLUGS } from '@/lib/format';
import type { SignalContext } from '@/lib/types';
import Header from '@/components/Header';
import ReportGenerator from '@/components/ReportGenerator';
import ReportPreview from '@/components/ReportPreview';
import WorkspaceTabs, { REPORTS_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';
// Hosts the report-generation server actions (data + per-context legs + synthesis + save).
export const maxDuration = 60;
export const metadata = { title: 'Period report generator · The Strategy Atlas' };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const dayString = (d: Date) => d.toISOString().slice(0, 10);

// Admin-only period-report generator, the Report Portal's console for the fortnight
// narrative (moved here from /report, which now redirects). Controls drive the live
// data preview via the URL (?from&to&contexts), like the digest page.
export default async function PeriodReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; contexts?: string }>;
}) {
  const admin = await requireAdminPage();
  const sp = await searchParams;

  // Default range: the last 90 days (so the preview is populated on first load).
  const today = new Date();
  const ninetyAgo = new Date(today);
  ninetyAgo.setDate(today.getDate() - 90);
  const to = sp.to && ISO_DAY.test(sp.to) ? sp.to.slice(0, 10) : dayString(today);
  const from = sp.from && ISO_DAY.test(sp.from) ? sp.from.slice(0, 10) : dayString(ninetyAgo);

  // Parse contexts (comma-separated), validate against the canonical set; default to both.
  const valid = new Set<string>(SIGNAL_CONTEXT_SLUGS);
  const parsed = (sp.contexts || '')
    .split(',')
    .map((s) => s.trim())
    .filter((c) => valid.has(c)) as SignalContext[];
  const contexts = parsed.length ? parsed : [...SIGNAL_CONTEXT_SLUGS];

  const [report, saved] = await Promise.all([
    buildReportData({ from, to, contexts, personal: true }),
    listSavedReports(),
  ]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead">
          <h1>Period report generator</h1>
          <p className="lede">
            Compile a period intelligence report from the Signal Board: pick a date range and the
            contexts to cover, generate the narrative, edit it, and save or export to PDF.
          </p>
        </header>
        <WorkspaceTabs tabs={REPORTS_TABS} active="/reports/period" />

        <ReportGenerator initialFrom={from} initialTo={to} initialContexts={contexts} initialSaved={saved} />
        <ReportPreview report={report} />
      </section>
    </>
  );
}

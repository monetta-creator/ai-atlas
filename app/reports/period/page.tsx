import { requireAdminPage } from '@/lib/auth';
import { buildReportData } from '@/lib/report';
import { listSavedReports } from '@/lib/data';
import { SIGNAL_LENS_SLUGS } from '@/lib/format';
import type { SignalLens } from '@/lib/types';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ReportGenerator from '@/components/ReportGenerator';
import ReportPreview from '@/components/ReportPreview';
import WorkspaceTabs, { REPORTS_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';
// Hosts the report-generation server actions (data + per-lens legs + synthesis + save).
export const maxDuration = 60;
export const metadata = { title: 'Period report generator · The AI Atlas' };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const dayString = (d: Date) => d.toISOString().slice(0, 10);

// Admin-only period-report generator, the Report Portal's console for the fortnight
// narrative (moved here from /report, which now redirects). Controls drive the live
// data preview via the URL (?from&to&lenses), like the digest page.
export default async function PeriodReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; lenses?: string }>;
}) {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();
  const sp = await searchParams;

  // Default range: the last 90 days (so the preview is populated on first load).
  const today = new Date();
  const ninetyAgo = new Date(today);
  ninetyAgo.setDate(today.getDate() - 90);
  const to = sp.to && ISO_DAY.test(sp.to) ? sp.to.slice(0, 10) : dayString(today);
  const from = sp.from && ISO_DAY.test(sp.from) ? sp.from.slice(0, 10) : dayString(ninetyAgo);

  // Parse lenses (comma-separated), validate against the canonical set; default to all six.
  const valid = new Set<string>(SIGNAL_LENS_SLUGS);
  const parsed = (sp.lenses || '')
    .split(',')
    .map((s) => s.trim())
    .filter((l) => valid.has(l)) as SignalLens[];
  const lenses = parsed.length ? parsed : [...SIGNAL_LENS_SLUGS];

  const [report, saved] = await Promise.all([
    buildReportData({ from, to, lenses, personal: true }),
    listSavedReports(),
  ]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead">
          <Editable
            as="h1"
            k="reports-period.title"
            value={txt('reports-period.title', 'Period report generator')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            k="reports-period.lede"
            value={txt(
              'reports-period.lede',
              'Compile a period intelligence report from the Signal Board: pick a date range and the lenses to cover, generate the narrative, edit it, and save or export to PDF.'
            )}
            editing={editing}
          />
        </header>
        <WorkspaceTabs tabs={REPORTS_TABS} active="/reports/period" />

        <ReportGenerator initialFrom={from} initialTo={to} initialLenses={lenses} initialSaved={saved} />
        <ReportPreview report={report} />
      </section>
    </>
  );
}

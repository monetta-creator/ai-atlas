import { isAdmin, isPortal } from '@/lib/auth';
import { getToolingCategories, listToolingReports } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ToolingUnlock from '@/components/tooling/ToolingUnlock';
import ToolingReportConsole from '@/components/tooling/ToolingReportConsole';

export const dynamic = 'force-dynamic';
// Hosts the pack -> sections -> close -> save chain, each its own bounded
// server action; the page's own cap covers whichever leg runs longest.
export const maxDuration = 120;
export const metadata = { title: 'Tooling reports · The AI Atlas' };

// The AI Tooling Monitor's report console: a category landscape, a
// build-or-buy brief, the weekly new entrants, or a feature-steal sheet,
// generated on demand. Public route (proxy.ts allow-lists /tooling/*except
// /tooling/console), but generating a report is a live model call, so a
// visitor with neither the admin session nor the portal cookie sees the
// inline unlock panel instead of the console (never a /login bounce).
export default async function ToolingReportsPage() {
  const [admin, portal, { editing, txt }] = await Promise.all([isAdmin(), isPortal(), getEditContext()]);

  const title = (
    <Editable
      as="h1"
      style={{ marginBottom: 10 }}
      k="tooling.reports.title"
      value={txt('tooling.reports.title', 'Tooling reports')}
      editing={editing}
    />
  );
  const lede = (
    <Editable
      as="p"
      className="lede"
      style={{ marginBottom: 20 }}
      k="tooling.reports.lede"
      value={txt(
        'tooling.reports.lede',
        'Generate a category landscape, a build-or-buy brief, the week’s new entrants, or a feature-steal sheet from the AI Tooling Monitor catalog.'
      )}
      editing={editing}
    />
  );

  if (!admin && !portal) {
    return (
      <>
        <Header admin={admin} />
        <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
          <header className="pagehead" style={{ paddingBottom: 30 }}>
            {title}
            {lede}
          </header>
          <ToolingUnlock />
        </section>
      </>
    );
  }

  const [categories, reports] = await Promise.all([
    getToolingCategories(admin),
    listToolingReports({ admin, portal: true }),
  ]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1000, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          {title}
          {lede}
        </header>
        <ToolingReportConsole categories={categories} reports={reports} admin={admin} />
      </section>
    </>
  );
}

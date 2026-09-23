import Link from 'next/link';
import { getPortalIdentity } from '@/lib/portal/identity';
import { SHEET_KIND_LABEL, dateLabel } from '@/lib/format';
import { getToolingCategories, listToolingReports } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import ToolingUnlock from '@/components/tooling/ToolingUnlock';
import ToolingReportConsole from '@/components/tooling/ToolingReportConsole';
import RenewalNotice from '@/components/portal/RenewalNotice';

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
  const [identity, { editing, txt }] = await Promise.all([getPortalIdentity(), getEditContext()]);
  const admin = identity.tier === 'admin';
  const portal = identity.active;

  const title = (
    <Editable
      as="h1"
      k="tooling.reports.title"
      value={txt('tooling.reports.title', 'Tooling reports')}
      editing={editing}
    />
  );

  if (!admin && !portal) {
    // Guests still get the shelf of PUBLISHED tooling reports (the same rows
    // /reports lists); only generating one sits behind the team key.
    const published = await listToolingReports({ admin: false, portal: false });
    return (
      <>
        <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
          <PageTop pathname="/tooling/reports" label="Tooling reports" viewer={{ admin, portal }} title={title} />
          {published.length > 0 && (
            <>
              <div className="section-label">Published tooling reports · {published.length}</div>
              <div className="flex flex-col gap-2" style={{ marginTop: 10, marginBottom: 30 }}>
                {published.map((r) => (
                  <div key={r.id} className="plate" style={{ display: 'block' }}>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{r.title}</span>
                        <div className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                          {SHEET_KIND_LABEL[r.kind as keyof typeof SHEET_KIND_LABEL] ?? r.kind}
                          {r.subject ? ` · ${r.subject}` : ''}
                          {dateLabel(r.generated_at) ? ` · ${dateLabel(r.generated_at)}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/reports/sheet/${r.id}`} className="btn btn--ghost btn--sm">Read</Link>
                        <a href={`/reports/sheet/${r.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <RenewalNotice identity={identity} style={{ marginBottom: 12 }} />
          <ToolingUnlock />
          <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--faint-ink)' }}>
            No key yet? <Link href="/datasets/request">Request an access key</Link>.
          </p>
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
      <section className="wrap" style={{ maxWidth: 1000, paddingBottom: 100 }}>
        <PageTop pathname="/tooling/reports" label="Tooling reports" viewer={{ admin, portal }} title={title} />
        <ToolingReportConsole categories={categories} reports={reports} admin={admin} />
      </section>
    </>
  );
}

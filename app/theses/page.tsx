import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getTheses } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import WorkspaceTabs, { REPORTS_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Theses · The AI Atlas' };

// Admin hub for standing theses: the claim-in, cited-report-out surface. Each
// thesis links to its run console (/theses/[id]); saved runs get public
// /thesis-report links to share.
export default async function ThesesPage() {
  const admin = await isAdmin();
  if (!admin) redirect('/login');
  const theses = await getTheses();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <header className="pagehead">
          <h1>Theses</h1>
          <p className="lede">
            Standing hypotheses tracked against the signal corpus. State a thesis, confirm which
            Atlas claims it bears on, and generate a deterministic, cited report to share.
          </p>
        </header>
        <WorkspaceTabs tabs={REPORTS_TABS} active="/theses" />

        <p style={{ margin: '0 0 18px' }}>
          <Link href="/theses/new" className="btn btn--primary">New thesis</Link>
        </p>

        {theses.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--faint-ink)' }}>
            No theses yet. Create one to start tracking a hypothesis.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="flex flex-col gap-3">
            {theses.map((t) => (
              <li key={t.id} style={{ opacity: t.status === 'archived' ? 0.6 : 1 }}>
                <Link href={`/theses/${t.id}`} className="plate">
                  <span
                    style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                      fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em',
                      textTransform: 'uppercase', color: 'var(--faint-ink)', marginBottom: 8,
                    }}
                  >
                    <span>
                      {t.status === 'archived' ? 'Archived thesis' : 'Standing thesis'}
                      {t.claim_codes.length > 0 && <> · maps to {t.claim_codes.join(', ')}</>}
                    </span>
                    <span>
                      {t.report_count ?? 0} run{(t.report_count ?? 0) === 1 ? '' : 's'}
                      {t.last_generated_at && ` · ${dateLabel(t.last_generated_at) ?? t.last_generated_at.slice(0, 10)}`}
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 16.5, fontWeight: 600, lineHeight: 1.4 }}>
                    {t.statement}
                  </span>
                  {t.claim_codes.length === 0 && (
                    <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--heat-2)' }}>
                      Not yet mapped to a claim: reports run text-only.
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

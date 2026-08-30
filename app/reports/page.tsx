import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import { listSavedReports, getLatestThesisReports, listGeneratedReports, getTargets } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { formatDateRange, dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SheetConsole from '@/components/reports/SheetConsole';
import SheetRow from '@/components/reports/SheetRow';

export const dynamic = 'force-dynamic';
// Hosts the sheet-generation server actions (pack + two model legs + save).
export const maxDuration = 60;
export const metadata = { title: 'Report Portal · The AI Atlas' };

// The Report Portal: pre-ready generators (admin), then the published shelf.
// Guests see published generated reports, period reports, and thesis reports,
// each with its branded PDF download; drafts and the console are admin-only.
// ?generate=claim&code=4.2 pre-fills the console (the claim pages link here).
export default async function ReportPortal({
  searchParams,
}: {
  searchParams: Promise<{ generate?: string | string[]; code?: string | string[] }>;
}) {
  const [admin, sp] = await Promise.all([isAdmin(), searchParams]);
  const { editing, txt } = await getEditContext();
  const [reports, theses, generated, targets] = await Promise.all([
    listSavedReports(),
    getLatestThesisReports(20),
    listGeneratedReports(!admin),
    admin ? getTargets() : Promise.resolve({ claims: [], bridges: [] }),
  ]);
  const published = generated.filter((g) => g.is_published);
  const drafts = generated.filter((g) => !g.is_published);
  const gen = typeof sp.generate === 'string' ? sp.generate : undefined;
  const initialKind = gen === 'claim' || gen === 'lens' || gen === 'atlas' ? gen : undefined;
  const initialCode = typeof sp.code === 'string' ? sp.code : undefined;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 26 }}>
          <Editable
            as="h1"
            k="reports.title"
            value={txt('reports.title', 'Report Portal')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            k="reports.lede"
            value={txt(
              'reports.lede',
              'Grounded reports from the Atlas corpus at claim, lens, thesis, and whole-Atlas granularity: cited, synthesized, and downloadable as branded PDFs.'
            )}
            editing={editing}
          />
        </header>

        {admin && (
          <div style={{ marginBottom: 34 }}>
            <div className="section-label">Generate a report</div>
            <SheetConsole
              claims={targets.claims.map((t) => ({ code: t.code, statement: t.statement }))}
              bridges={targets.bridges.map((t) => ({ code: t.code, statement: t.statement }))}
              initialKind={initialKind}
              initialCode={initialCode}
            />
          </div>
        )}

        {admin && drafts.length > 0 && (
          <div style={{ marginBottom: 34 }}>
            <div className="section-label">Drafts · {drafts.length} · publish to list them below</div>
            <div className="flex flex-col gap-[10px]">
              {drafts.map((g) => <SheetRow key={g.id} meta={g} admin />)}
            </div>
          </div>
        )}

        <div className="section-label">Generated reports · {published.length}</div>
        {published.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>Nothing published yet.</p>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {published.map((g) => <SheetRow key={g.id} meta={g} admin={admin} />)}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 28 }}>Period reports · {reports.length}</div>
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
                  {r.lenses.length > 0 ? ` · ${r.lenses.length} lens${r.lenses.length === 1 ? '' : 'es'}` : ''}
                  {dateLabel(r.updated_at) ? ` · saved ${dateLabel(r.updated_at)}` : ''}
                </span>
                <a href={`/reports/${r.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
              </div>
            ))}
          </div>
        )}

        <div className="section-label" style={{ marginTop: 28 }}>Thesis reports · {theses.length}</div>
        {theses.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No thesis reports yet.</p>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {theses.map((t) => (
              <div key={t.report_id} className="plate flex items-baseline gap-3 flex-wrap">
                <Link href={`/thesis-report/${t.report_id}`} className="hover:underline"
                  style={{ fontWeight: 600, fontSize: 15.5, color: 'var(--ink)', flex: 1, minWidth: 260 }}>
                  {t.statement}
                </Link>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {t.matched} matched · {t.supports}s / {t.contradicts}c
                  {dateLabel(t.generated_at) ? ` · ${dateLabel(t.generated_at)}` : ''}
                </span>
                <a href={`/thesis-report/${t.report_id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
              </div>
            ))}
          </div>
        )}

      </section>
    </>
  );
}

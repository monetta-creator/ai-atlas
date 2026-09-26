import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import { getSavantPrefs, getNotebookWeeks, getNotebook, getHypotheses } from '@/lib/data/savant';
import { getNavCounts } from '@/lib/data';
import { weekEndFor, isoDay } from '@/lib/savant/week';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';
import DeskNotebook from '@/components/savant/DeskNotebook';
import SavantPrefsForm from '@/components/savant/SavantPrefsForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Savant desk · The AI Atlas' };

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', strengthened: 'Strengthened', weakened: 'Weakened', closed: 'Closed',
};

// The admin console over Savant's weekly notebook (what the weekday pass
// wrote: the Monday plan, daily notes, connections/echoes/anomalies/misses)
// and its hypotheses ledger (what the Friday issue is tracking over time),
// plus the prefs card. The issue's own read view and the notebook writer
// land in a later phase; this is the desk that watches them work.
export default async function SavantDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const gate = await adminGate('/savant/desk', 'Savant desk');
  if (gate) return gate;

  const sp = await searchParams;
  const currentWeek = weekEndFor(isoDay(new Date()));
  const week = sp.week && WEEK_RE.test(sp.week) ? sp.week : currentWeek;

  const [prefs, weeks, rows, hypotheses, counts] = await Promise.all([
    getSavantPrefs(),
    getNotebookWeeks(12),
    getNotebook(week),
    getHypotheses(40),
    getNavCounts().catch(() => null),
  ]);

  const openCount = hypotheses.filter((h) => h.status === 'open').length;

  return (
    <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
      <PageTop pathname="/savant/desk" label="Savant desk" viewer={{ admin: true, portal: true }} counts={counts}>
        Week ending {dateLabel(week) ?? week} · {rows.length} notebook rows · {openCount} open hypotheses
      </PageTop>

      <div className="sv-desk">
        <section className="sv-section">
          <h2 className="sv-h2">This week&apos;s notebook</h2>
          <DeskNotebook weekEnd={week} currentWeek={currentWeek} weeks={weeks} rows={rows} />
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Hypotheses ledger</h2>
          {hypotheses.length === 0 ? (
            <p className="sv-empty">No hypotheses posed yet.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Question</th>
                  <th>Posed</th>
                  <th>Status</th>
                  <th>Updates</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {hypotheses.map((h) => (
                  <tr key={h.id}>
                    <td>{h.statement}</td>
                    <td>{h.question_slug ? <Link href={`/q/${h.question_slug}`}>{h.question_slug}</Link> : '–'}</td>
                    <td>{dateLabel(h.posed_week) ?? h.posed_week}</td>
                    <td><span className="sv-status" data-status={h.status}>{STATUS_LABEL[h.status] ?? h.status}</span></td>
                    <td>{h.updates.length}</td>
                    <td>{h.verdict ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Prefs</h2>
          <SavantPrefsForm prefs={prefs} />
        </section>
      </div>
    </section>
  );
}

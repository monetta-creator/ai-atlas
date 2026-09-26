import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import { getSavantPrefs, getNotebookWeeks, getNotebook, getHypotheses, getModelRates } from '@/lib/data/savant';
import { listSavantIssues } from '@/lib/data/savant-issues';
import { getNavCounts } from '@/lib/data';
import { weekEndFor, isoDay } from '@/lib/savant/week';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';
import DeskNotebook from '@/components/savant/DeskNotebook';
import SavantPrefsForm from '@/components/savant/SavantPrefsForm';
import RunIssueButton from '@/components/savant/RunIssueButton';

export const dynamic = 'force-dynamic';
// The run button's server action researches, writes and edits an issue in
// legs of up to 270s; the page's maxDuration covers it (the cron routes' 300).
export const maxDuration = 300;
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

  const [prefs, weeks, rows, hypotheses, counts, issues, rates] = await Promise.all([
    getSavantPrefs(),
    getNotebookWeeks(12),
    getNotebook(week),
    getHypotheses(40),
    getNavCounts().catch(() => null),
    listSavantIssues(20, false),
    getModelRates().catch(() => ({})),
  ]);
  const weekIssue = issues.find((i) => i.week_end === week) ?? null;

  const openCount = hypotheses.filter((h) => h.status === 'open').length;

  return (
    <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
      <PageTop
        pathname="/savant/desk"
        label="Desk"
        viewer={{ admin: true, portal: true }}
        counts={counts}
      >
        Week ending {dateLabel(week) ?? week} · {rows.length} notebook rows · {openCount} open hypotheses · {issues.length} issue{issues.length === 1 ? '' : 's'} published
      </PageTop>

      <div className="sv-desk">
        <section className="sv-section">
          <h2 className="sv-h2">Issues</h2>
          {issues.length === 0 ? (
            <p className="sv-empty">No issue yet. The Friday run writes one at 20:00 UTC; Run below writes this week&apos;s now.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr><th>No.</th><th>Week ending</th><th>Title</th><th></th></tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td>{i.issueNumber ?? '–'}</td>
                    <td>{dateLabel(i.week_end) ?? i.week_end}</td>
                    <td><Link href={`/savant/${i.week_end}`}>{i.title}</Link>{!i.is_published && <span className="sv-chip" style={{ marginLeft: 8 }}>draft</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link href={`/savant/${i.week_end}`} className="btn btn--ghost btn--sm">Read</Link>{' '}
                      <a href={`/savant/${i.week_end}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="sv-run-lede">
            Week ending {dateLabel(week) ?? week}: {weekIssue ? `issue No. ${weekIssue.issueNumber ?? ''} is published.` : 'no issue yet.'}
          </p>
          <RunIssueButton weekEnd={week} hasIssue={Boolean(weekIssue)} />
        </section>

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
          <SavantPrefsForm prefs={prefs} rates={rates} />
        </section>
      </div>
    </section>
  );
}

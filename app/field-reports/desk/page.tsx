import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import PageTop from '@/components/PageTop';
import FieldReportPrefsForm from '@/components/field-report/FieldReportPrefsForm';
import { getFieldReportPrefs, getModelRates } from '@/lib/field-report/store';
import { listFieldReportRuns, getFieldReportSpendToday, getNavCounts } from '@/lib/data';
import { SAVANT_MODEL_OPTIONS, fmtUsd } from '@/lib/savant/cost-model';

// The admin desk over Field Report's settings singleton and its run history:
// the enabled switch, model pickers per role and size (research, writer and
// editor call the Anthropic Messages API directly, so those pickers only
// offer Anthropic ids; figures goes through routedStructured and can pick
// any option), effort, web searches, both daily caps, a live estimate, and
// the last 30 runs. docs/field-report.md.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Report desk · The AI Atlas' };

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', running: 'Running', paused: 'Paused', done: 'Done', failed: 'Failed',
};

// 'H:MM AM/PM ET' for a run's created_at. Self-contained rather than a
// cross-portal import: the same shape as lib/ops/registry.ts's fmtEt, with
// the month/day added since a run list spans more than one day.
function etTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)} ET`;
}

export default async function FieldReportDeskPage() {
  const gate = await adminGate('/field-reports/desk', 'Field Report desk');
  if (gate) return gate;

  const prefs = await getFieldReportPrefs();
  const modelIds = [...new Set(SAVANT_MODEL_OPTIONS.map((m) => m.id))];
  const [rateMap, runs, spend, counts] = await Promise.all([
    getModelRates(modelIds),
    listFieldReportRuns(30),
    getFieldReportSpendToday(),
    getNavCounts().catch(() => null),
  ]);
  const rates = Object.fromEntries(rateMap);

  return (
    <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
      <PageTop
        pathname="/field-reports/desk"
        label="Desk"
        viewer={{ admin: true, portal: true }}
        counts={counts}
      >
        {prefs.enabled ? 'Enabled' : 'Disabled'} &middot; today: {fmtUsd(spend.total)} total, {fmtUsd(spend.allKeys)} across keys
        (cap {fmtUsd(prefs.allKeysDailyUsd)})
      </PageTop>

      <div className="sv-desk frd-desk">
        <section className="sv-section">
          <h2 className="sv-h2">Prefs</h2>
          <FieldReportPrefsForm prefs={prefs} rates={rates} />
        </section>

        <section className="sv-section">
          <h2 className="sv-h2">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="sv-empty">No runs yet. Start one from /ask with Field Report on.</p>
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Who</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th>Title</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{etTime(r.createdAt)}</td>
                    <td>{r.who}</td>
                    <td>{r.size === 'full' ? 'Full' : 'Brief'}</td>
                    <td><span className="frd-run-status" data-status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td style={{ textAlign: 'right' }}>{r.costUsd > 0 ? fmtUsd(r.costUsd) : '–'}</td>
                    <td>{r.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'done' && r.reportId ? (
                        <Link href={`/field-reports/${r.reportId}`} className="btn btn--ghost btn--sm">Read</Link>
                      ) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </section>
  );
}

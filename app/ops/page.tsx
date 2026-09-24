import { adminGate } from '@/lib/admin-gate';
import { getOpsStatus, getOpsHistory, getOpsBackground, getNavCounts } from '@/lib/data';
import PageTop from '@/components/PageTop';
import OpsRefresh from '@/components/ops/OpsRefresh';
import OpsHistoryGrid from '@/components/ops/OpsHistoryGrid';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata = { title: 'Operations · The AI Atlas' };

// The one authoritative view of everything that runs in the background:
// today's timeline, every registered job's last run and next fire, a 14-day
// history grid, and the background work that has no cron of its own. Reads
// lib/ops/registry.ts (the job list, derived from vercel.json) through
// lib/data/ops.ts (getOpsStatus / getOpsHistory / getOpsBackground) so a new
// cron entry cannot silently go unlisted here (scripts/test-ops-registry.mjs
// enforces the registry side of that).
export default async function OpsPage() {
  const gate = await adminGate('/ops', 'Operations');
  if (gate) return gate;
  const admin = true as const;

  const [status, history, background, counts] = await Promise.all([
    getOpsStatus(),
    getOpsHistory(14),
    getOpsBackground(),
    getNavCounts().catch(() => null),
  ]);

  return (
    <section className="wrap" style={{ maxWidth: 1180, paddingBottom: 100 }}>
      <PageTop pathname="/ops" label="Operations" viewer={{ admin, portal: admin }} counts={counts}>
        {status.jobs.length} registered jobs across every /api/cron/* schedule
      </PageTop>

      <div className="ops-page">
        <OpsRefresh initialStatus={status} />

        <section className="ops-section">
          <h2 className="ops-h2">Last 14 days</h2>
          <OpsHistoryGrid rows={history} />
        </section>

        <section className="ops-section">
          <h2 className="ops-h2">Background work</h2>
          <div className="ops-grid">
            <div className="ops-card">
              <div className="ops-card-head">
                <span className="ops-card-title">Embedding hooks</span>
              </div>
              <p className="ops-card-desc">
                Incremental hooks embed a record right after it is created or edited; the nightly gap is the backstop.
              </p>
              <div className="ops-card-foot">
                <span>{background.embeddingsMissing} missing</span>
                <span>${background.embedSpendUsd.toFixed(2)} of ${background.embedCapUsd.toFixed(2)} today</span>
              </div>
            </div>

            <div className="ops-card">
              <div className="ops-card-head">
                <span className="ops-card-title">Promotion sweep</span>
              </div>
              <p className="ops-card-desc">
                High-significance pipeline drafts with a claim touch publish on their own after the veto window, on every pipeline cron window.
              </p>
              <div className="ops-card-foot">
                <span>{background.promotedToday} published today</span>
              </div>
            </div>

            <div className="ops-card">
              <div className="ops-card-head">
                <span className="ops-card-title">Atlas Agent findings</span>
              </div>
              <p className="ops-card-desc">
                Every sensor check runs on the hourly tick; open findings wait on a remedy or a snooze.
              </p>
              <div className="ops-card-foot">
                <span>{background.agentOpenFindings} open</span>
                <span>{background.agentHighFindings} high severity</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

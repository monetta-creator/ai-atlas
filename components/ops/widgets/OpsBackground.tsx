import { getOpsBackground } from '@/lib/data/ops';

// 'ops-background': the work that runs from inside another request rather
// than a schedule of its own (embedding hooks, the promotion sweep, the
// Atlas Agent's checks).
export default async function OpsBackground() {
  let background: Awaited<ReturnType<typeof getOpsBackground>>;
  try {
    background = await getOpsBackground();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  return (
    <>
      <div className="lw-head">Background work</div>
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
    </>
  );
}

'use client';

import { useState } from 'react';
import type { AgentFinding, FindingState } from '@/lib/agent/types';
import { runRemedyAction, setFindingStateAction } from '@/lib/actions';

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor(ms / 3_600_000));
    return `open ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `open ${days} day${days === 1 ? '' : 's'}`;
}

// One finding, in the drawer's Findings tab or the console page's inline
// list. Do it runs the finding's remedy and shows the returned summary
// in place; Snooze/Dismiss/Undo just change state. Every mutating call
// reloads the parent's data (`onReload`) rather than optimistically
// patching, since the runner may also have changed other findings.
export default function FindingCard({
  finding, onReload,
}: { finding: AgentFinding; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const metricEntries = Object.entries(finding.metric).slice(0, 6);
  const acked = finding.state === 'acked';

  async function doIt() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await runRemedyAction(finding.key);
      setResult(r.summary);
    } catch {
      setResult('The remedy failed to run.');
    } finally {
      setBusy(false);
      onReload();
    }
  }

  async function changeState(state: FindingState, snoozeDays?: number) {
    if (busy) return;
    setBusy(true);
    try {
      await setFindingStateAction(finding.key, state, snoozeDays);
    } finally {
      setBusy(false);
      onReload();
    }
  }

  return (
    <div className="ag-card" data-sev={finding.severity} data-state={finding.state}>
      <div className="ag-card-head">
        <span className="ag-chip" data-sev={finding.severity}>{finding.severity}</span>
        <span className="ag-card-title">{finding.title}</span>
      </div>
      <p className="ag-card-detail">{finding.detail}</p>
      {metricEntries.length > 0 && (
        <div className="ag-metric">
          {metricEntries.map(([k, v]) => (
            <span key={k}>{k}: {String(v)}</span>
          ))}
        </div>
      )}
      <div className="ag-card-foot">
        <span className="ag-card-age">{age(finding.first_seen)}</span>
        {finding.href && (
          <a href={finding.href} className="ag-card-open">Open →</a>
        )}
      </div>
      <div className="ag-remedy">
        {finding.remedy?.tier === 'auto' && (
          <>
            <span>I handle this on the next tick.</span>
            <button type="button" className="btn btn--quiet btn--sm" onClick={doIt} disabled={busy}>
              Do it now
            </button>
          </>
        )}
        {finding.remedy?.tier === 'propose' && (
          <>
            <span>Needs your tap.</span>
            <button type="button" className="btn btn--primary btn--sm" onClick={doIt} disabled={busy}>
              Do it
            </button>
          </>
        )}
        {(!finding.remedy || finding.remedy.tier === 'never') && <span>Yours alone.</span>}
      </div>
      {result && <p className="ag-card-result">{result}</p>}
      <div className="ag-actions">
        {acked ? (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => changeState('open')} disabled={busy}>
            Undo
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => changeState('snoozed', 3)} disabled={busy}>
              Snooze 3d
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => changeState('acked')} disabled={busy}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

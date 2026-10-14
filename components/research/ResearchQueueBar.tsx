'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  acceptAgentRecommendationsAction, applyResearchQueuePolicyAction,
  dismissStalePapersAction, setResearchQueuePolicyAction,
} from '@/lib/actions';
import { suggestThreshold } from '@/lib/research/queue-core';
import type { ResearchQueueStats } from '@/lib/types';

// The research review desk's backlog bar (the signal DraftBacklogBar's shape):
// the queue's shape, the judgment-free cuts (each dismisses or notes; nothing
// is deleted and every decision is reversible from the paper page), the
// auto-dismiss policy, and the agent-agreement record that says how far the
// policy can be trusted. No model call anywhere on this bar.
export default function ResearchQueueBar({
  stats, policy,
}: {
  stats: ResearchQueueStats;
  policy: { autoDismiss: boolean; minConfidence: number; staleDays: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [conf, setConf] = useState(String(policy.minConfidence));
  const [stale, setStale] = useState(String(policy.staleDays));

  async function run(key: string, fn: () => Promise<string>) {
    if (busy) return;
    setBusy(key);
    setNote(null);
    try {
      setNote(await fn());
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That failed.');
    } finally {
      setBusy(null);
    }
  }

  function savePolicy(next: Partial<typeof policy>, message: string) {
    const p = { ...policy, ...next };
    void run('policy', async () => {
      await setResearchQueuePolicyAction(p.autoDismiss, p.minConfidence, p.staleDays);
      return message;
    });
  }

  function confirmRun(key: string, n: number, question: string, fn: () => Promise<number>, done: (k: number) => string) {
    if (n === 0) return;
    if (!window.confirm(question)) return;
    void run(key, async () => done(await fn()));
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pctOf = (a: { n: number; agreed: number }) =>
    a.n > 0 ? `${a.agreed}/${a.n} (${Math.round((a.agreed / a.n) * 100)}%)` : 'no calls yet';
  const suggestion = suggestThreshold(stats.dismissBands);

  return (
    <div className="dbb">
      <div className="dbb-counts">
        <span><strong>{stats.pending}</strong> awaiting review</span>
        <span className="dot" />
        <span>
          agent: {stats.byRec.tracked} track · {stats.byRec.noted} note · {stats.byRec.dismissed} dismiss
          {stats.byRec.none > 0 ? ` · ${stats.byRec.none} unread` : ''}
        </span>
        {stats.oldestDays != null && (<><span className="dot" /><span>oldest {plural(stats.oldestDays, 'day')}</span></>)}
        <span className="dot" />
        <span>{stats.autoDismissed30d} auto-dismissed in 30 days</span>
      </div>

      <div className="dbb-row">
        <span className="dbb-label">Cut before reading</span>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.byRec.dismissed === 0}
          onClick={() => confirmRun('dismissed', stats.byRec.dismissed,
            `Dismiss all ${plural(stats.byRec.dismissed, 'paper')} the agent would dismiss, at any confidence? Rows stay; rising citations resurface them.`,
            async () => (await acceptAgentRecommendationsAction('dismissed')).ids.length,
            (k) => `Dismissed ${plural(k, 'paper')} on the agent's call.`)}>
          Dismiss {stats.byRec.dismissed} the agent would dismiss
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.stale === 0}
          onClick={() => confirmRun('stale', stats.stale,
            `Dismiss ${plural(stats.stale, 'paper')} waiting more than ${policy.staleDays} days that the agent did not mark for tracking?`,
            () => dismissStalePapersAction(),
            (k) => `Dismissed ${plural(k, 'stale paper')}.`)}>
          Dismiss {stats.stale} older than
        </button>
        <input
          className="input dbb-hours" type="number" min={3} max={180} value={stale}
          aria-label="Staleness window in days"
          onChange={(e) => setStale(e.target.value)}
          onBlur={() => {
            const d = Number(stale);
            if (Number.isFinite(d) && d >= 3 && d <= 180 && d !== policy.staleDays) {
              savePolicy({ staleDays: d }, `Staleness window set to ${d} days.`);
            }
          }}
        />
        <span className="dbb-muted">days</span>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.byRec.noted === 0}
          onClick={() => confirmRun('noted', stats.byRec.noted,
            `Note all ${plural(stats.byRec.noted, 'paper')} the agent would note? Noted papers appear on the public Research Portal shelf.`,
            async () => (await acceptAgentRecommendationsAction('noted')).ids.length,
            (k) => `Noted ${plural(k, 'paper')} on the agent's call.`)}>
          Note {stats.byRec.noted} the agent would note
        </button>
      </div>

      <div className="dbb-row">
        <span className="dbb-label">Auto-dismiss</span>
        <label className="dbb-toggle">
          <input
            type="checkbox" checked={policy.autoDismiss} disabled={!!busy}
            onChange={(e) => savePolicy(
              { autoDismiss: e.target.checked },
              e.target.checked ? 'Auto-dismiss on: it runs after the agent step of every engine window.' : 'Auto-dismiss off.'
            )}
          />
          <span>Agent dismissals at</span>
        </label>
        <input
          className="input dbb-hours" type="number" min={50} max={100} value={conf}
          aria-label="Minimum agent confidence"
          onChange={(e) => setConf(e.target.value)}
          onBlur={() => {
            const c = Number(conf);
            if (Number.isFinite(c) && c >= 50 && c <= 100 && c !== policy.minConfidence) {
              savePolicy({ minConfidence: c }, `Auto-dismiss bar set to ${c}.`);
            }
          }}
        />
        <span className="dbb-muted">confidence or higher clear after each engine run · {stats.policyDue} due now</span>
        <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || !policy.autoDismiss || stats.policyDue === 0}
          onClick={() => void run('apply', async () => `Auto-dismissed ${plural(await applyResearchQueuePolicyAction(), 'paper')}.`)}>
          Run now
        </button>
      </div>

      <div className="dbb-row">
        <span className="dbb-label">Agent agreement</span>
        <span className="dbb-muted">
          your paper-by-paper calls, 90 days · track {pctOf(stats.agreement.tracked)} · note {pctOf(stats.agreement.noted)} · dismiss {pctOf(stats.agreement.dismissed)}
        </span>
        {suggestion ? (
          <>
            <span className="dbb-muted">
              · dismissals from {suggestion.threshold} up held {Math.round(suggestion.rate * 100)}% of {suggestion.n}
            </span>
            {suggestion.threshold !== policy.minConfidence && (
              <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy}
                onClick={() => { setConf(String(suggestion.threshold)); savePolicy({ minConfidence: suggestion.threshold }, `Auto-dismiss bar set to ${suggestion.threshold}.`); }}>
                Use {suggestion.threshold}
              </button>
            )}
          </>
        ) : (
          <span className="dbb-muted">· too few calls yet to suggest a bar (needs 20 at 95%)</span>
        )}
      </div>

      {note && <p className="dbb-note">{note}</p>}
    </div>
  );
}

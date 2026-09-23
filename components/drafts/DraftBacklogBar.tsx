'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkArchiveDraftsAction, promoteDueDraftsAction, setAutoPublishAction } from '@/lib/actions';
import type { DraftBacklogStats } from '@/lib/data/signals';

// The backlog bar above the review sprint: the counts, the three
// judgment-free cuts (each archives, never deletes: every row and link the
// crons pulled stays in the database), and the promotion policy with its
// toggle, veto window, and a manual "run now".
export default function DraftBacklogBar({
  stats, policy,
}: {
  stats: DraftBacklogStats;
  policy: { enabled: boolean; afterHours: number; from: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hours, setHours] = useState(String(policy.afterHours));

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

  function cut(kind: 'no_touches' | 'low' | 'stale', n: number, label: string) {
    if (n === 0) return;
    if (!window.confirm(`Archive ${n} draft${n === 1 ? '' : 's'} (${label})? Nothing is deleted; they move to the archived view.`)) return;
    void run(kind, async () => {
      const done = await bulkArchiveDraftsAction(kind);
      return `Archived ${done} draft${done === 1 ? '' : 's'} (${label}).`;
    });
  }

  const from = policy.from.slice(0, 10);

  return (
    <div className="dbb">
      <div className="dbb-counts">
        <span><strong>{stats.active}</strong> active drafts</span>
        <span className="dot" />
        <span>{stats.high} high · {stats.medium} medium · {stats.low} low</span>
        <span className="dot" />
        <span>{stats.archived} archived (kept)</span>
      </div>

      <div className="dbb-row">
        <span className="dbb-label">Cut before reading</span>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.noTouches === 0}
          onClick={() => cut('no_touches', stats.noTouches, 'no claim touches')}>
          Archive {stats.noTouches} with no claim touches
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.low === 0}
          onClick={() => cut('low', stats.low, 'low significance')}>
          Archive {stats.low} low significance
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || stats.stale === 0}
          onClick={() => cut('stale', stats.stale, `older than ${stats.staleDays} days`)}>
          Archive {stats.stale} older than {stats.staleDays} days
        </button>
      </div>

      <div className="dbb-row">
        <span className="dbb-label">Promotion policy</span>
        <label className="dbb-toggle">
          <input
            type="checkbox"
            checked={policy.enabled}
            disabled={!!busy}
            onChange={(e) => void run('toggle', async () => {
              await setAutoPublishAction(e.target.checked, Number(hours) || policy.afterHours);
              return e.target.checked ? 'Promotion on. The eligibility clock restarts now.' : 'Promotion off.';
            })}
          />
          <span>High-significance pipeline drafts with a claim touch publish on their own after</span>
        </label>
        <input
          className="input dbb-hours"
          type="number" min={1} max={720} value={hours}
          aria-label="Veto window in hours"
          onChange={(e) => setHours(e.target.value)}
          onBlur={() => {
            const h = Number(hours);
            if (Number.isFinite(h) && h >= 1 && h <= 720 && h !== policy.afterHours) {
              void run('hours', async () => { await setAutoPublishAction(policy.enabled, h); return `Veto window set to ${h} hours.`; });
            }
          }}
        />
        <span className="dbb-muted">hours unless archived · drafts created since {from} · {stats.dueForPromotion} due now · {stats.autoPublished30d} promoted in 30 days</span>
        <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy || !policy.enabled || stats.dueForPromotion === 0}
          onClick={() => void run('promote', async () => {
            const n = await promoteDueDraftsAction();
            return `Promoted ${n} draft${n === 1 ? '' : 's'}.`;
          })}>
          Run now
        </button>
      </div>

      {note && <p className="dbb-note">{note}</p>}
    </div>
  );
}

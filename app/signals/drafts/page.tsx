import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import {
  getSignalsPage, getDedupeScan, getActiveDraftIds, reconcileDedupeScan,
  getSprintDrafts, getDraftBacklogStats, getBackfillDraftCount, getPipelinePrefs, getTargets, getNavCounts,
} from '@/lib/data';
import DraftBacklogBar from '@/components/drafts/DraftBacklogBar';
import DraftSprint from '@/components/drafts/DraftSprint';
import { getEditContext } from '@/lib/content';
import PageTop from '@/components/PageTop';
import Editable from '@/components/Editable';
import DraftQueue from '@/components/DraftQueue';

export const dynamic = 'force-dynamic';
// Hosts the "Scan for duplicates" AI action (a single non-web call); fits the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Draft queue · The AI Atlas' };

// Admin-only working queue of UNPUBLISHED signals, with a manual duplicate scan. Separate
// from the public published feed at /signals so neither page is one long scroll.
// `?batch=backfill` switches the sprint to the history-canon drafts (mig 0076),
// a separate batch reviewed on purpose and excluded from the live default.
export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const gate = await adminGate('/signals/drafts', 'Draft queue');
  if (gate) return gate;
  const { batch: batchParam } = await searchParams;
  const batch: 'live' | 'backfill' = batchParam === 'backfill' ? 'backfill' : 'live';
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const prefs = await getPipelinePrefs();
  const policy = { enabled: prefs.auto_publish_high, afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from };
  const [active, archived, persisted, activeIds, sprint, stats, targets, backfillCount] = await Promise.all([
    getSignalsPage({ admin: true, status: 'unpublished' }),
    getSignalsPage({ admin: true, status: 'archived' }),
    getDedupeScan(),
    getActiveDraftIds(),
    getSprintDrafts(500, batch),
    getDraftBacklogStats(policy),
    getTargets(),
    getBackfillDraftCount(),
  ]);
  const counts = await countsP;
  const statements: Record<string, string> = {};
  for (const t of [...targets.claims, ...targets.bridges]) statements[t.code] = t.statement;
  // Reconcile the persisted scan against live drafts so it never shows a since-removed one.
  const initialRec = reconcileDedupeScan(persisted, new Set(activeIds));

  return (
    <>
      <section className="wrap">
        <PageTop
          pathname="/signals/drafts"
          label="Draft queue"
          viewer={{ admin, portal: true }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="signals-drafts.title"
              value={txt('signals-drafts.title', 'Draft queue')}
              editing={editing}
            />
          }
        />

        <DraftBacklogBar stats={stats} policy={policy} />

        <div className="ds-batch">
          <Link href="/signals/drafts" data-active={batch === 'live'}>Live drafts</Link>
          <Link href="/signals/drafts?batch=backfill" data-active={batch === 'backfill'}>Backfill ({backfillCount})</Link>
        </div>

        <div className="section-label" style={{ marginTop: 14 }}>
          {batch === 'backfill' ? 'Backfill review · oldest article first' : 'Review sprint · high significance first'}
        </div>
        <DraftSprint key={batch} drafts={sprint} statements={statements} batch={batch} />

        <details className="ds-list" style={{ marginTop: 34 }}>
          <summary>Full list, archived view, and the duplicate scan</summary>
          <div style={{ marginTop: 14 }}>
            <DraftQueue active={active} archived={archived} initialRec={initialRec} />
          </div>
        </details>
      </section>
    </>
  );
}

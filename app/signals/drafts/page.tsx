import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import {
  getSignalsPage, getDedupeScan, getActiveDraftIds, reconcileDedupeScan,
  getSprintDrafts, getDraftBacklogStats, getPipelinePrefs, getTargets,
} from '@/lib/data';
import DraftBacklogBar from '@/components/drafts/DraftBacklogBar';
import DraftSprint from '@/components/drafts/DraftSprint';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import DraftQueue from '@/components/DraftQueue';

export const dynamic = 'force-dynamic';
// Hosts the "Scan for duplicates" AI action (a single non-web call); fits the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Draft queue · The AI Atlas' };

// Admin-only working queue of UNPUBLISHED signals, with a manual duplicate scan. Separate
// from the public published feed at /signals so neither page is one long scroll.
export default async function DraftsPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const prefs = await getPipelinePrefs();
  const policy = { enabled: prefs.auto_publish_high, afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from };
  const [active, archived, persisted, activeIds, sprint, stats, targets] = await Promise.all([
    getSignalsPage({ admin: true, status: 'unpublished' }),
    getSignalsPage({ admin: true, status: 'archived' }),
    getDedupeScan(),
    getActiveDraftIds(),
    getSprintDrafts(),
    getDraftBacklogStats(policy),
    getTargets(),
  ]);
  const statements: Record<string, string> = {};
  for (const t of [...targets.claims, ...targets.bridges]) statements[t.code] = t.statement;
  // Reconcile the persisted scan against live drafts so it never shows a since-removed one.
  const initialRec = reconcileDedupeScan(persisted, new Set(activeIds));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap">
        <header className="pagehead">
          <div className="crumbs">
            <Link href="/signals">Signal Board</Link> / Draft queue
          </div>
          <Editable
            as="h1"
            k="signals-drafts.title"
            value={txt('signals-drafts.title', 'Draft queue')}
            editing={editing}
          />
          <p className="lede">
            Your unpublished working queue, admin-only. Publishing a draft adds its findings to the{' '}
            <Link href="/map">Argument Map</Link>. Archiving sets a draft aside and keeps everything:
            the row, its source link, and its candidate all stay in the database.
          </p>
        </header>

        <DraftBacklogBar stats={stats} policy={policy} />

        <div className="section-label" style={{ marginTop: 28 }}>Review sprint · high significance first</div>
        <DraftSprint drafts={sprint} statements={statements} />

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

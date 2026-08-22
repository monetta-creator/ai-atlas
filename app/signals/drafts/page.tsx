import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getSignalsPage, getDedupeScan, getActiveDraftIds, reconcileDedupeScan } from '@/lib/data';
import Header from '@/components/Header';
import DraftQueue from '@/components/DraftQueue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Draft queue · The Strategy Atlas' };

// Admin-only working queue of UNPUBLISHED signals, with a manual duplicate scan. Separate
// from the public published feed at /signals so neither page is one long scroll.
export default async function DraftsPage() {
  const admin = await requireAdminPage();

  const [active, archived, persisted, activeIds] = await Promise.all([
    getSignalsPage({ admin: true, status: 'unpublished' }),
    getSignalsPage({ admin: true, status: 'archived' }),
    getDedupeScan(),
    getActiveDraftIds(),
  ]);
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
          <h1>Draft queue</h1>
          <p className="lede">
            Your unpublished working queue, admin-only. Publishing a draft adds its findings to the{' '}
            <Link href="/map">Argument Map</Link>. Scan for duplicates before publishing to consolidate
            the same story reported by different sources.
          </p>
        </header>

        <DraftQueue active={active} archived={archived} initialRec={initialRec} />
      </section>
    </>
  );
}

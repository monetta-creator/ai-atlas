import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getCalibration } from '@/lib/data';
import { snapshotAction } from '@/lib/actions';
import Header from '@/components/Header';
import CalibrationView from '@/components/CalibrationView';
import WorkspaceTabs, { ANALYTICS_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calibration · The Strategy Atlas' };

// Admin-only: the confidence history is the personal layer made legible. Every move
// already writes a snapshot + rationale (moveConfidence); this is the reader.
export default async function CalibrationPage() {
  const admin = await requireAdminPage();

  const data = await getCalibration();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Calibration
        </div>

        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}>Calibration</h1>
          <p className="lede" style={{ fontSize: 14, marginTop: 8 }}>
            The living record: how your confidences have moved over time, and the reason behind
            every move. Each confidence move writes a snapshot automatically; capture one any time
            to freeze the current state.
          </p>
        </header>
        <WorkspaceTabs tabs={ANALYTICS_TABS} active="/calibration" />

        <form action={snapshotAction} style={{ marginBottom: 20 }}>
          <button type="submit" className="btn btn--ghost btn--sm">Capture snapshot now</button>
        </form>

        <CalibrationView data={data} />
      </section>
    </>
  );
}

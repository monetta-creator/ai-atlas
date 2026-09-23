import { adminGate } from '@/lib/admin-gate';
import { getCalibration, getNavCounts } from '@/lib/data';
import { snapshotAction } from '@/lib/actions';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import CalibrationView from '@/components/CalibrationView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calibration · The AI Atlas' };

// Admin-only: the confidence history is the personal layer made legible. Every move
// already writes a snapshot + rationale (moveConfidence); this is the reader.
export default async function CalibrationPage() {
  const gate = await adminGate('/calibration', 'Calibration');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const data = await getCalibration();
  const counts = await countsP;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname="/calibration"
          label="Calibration"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="calibration.title"
              value={txt('calibration.title', 'Calibration')}
              editing={editing}
            />
          }
        />

        <form action={snapshotAction} style={{ marginBottom: 20 }}>
          <button type="submit" className="btn btn--ghost btn--sm">Capture snapshot now</button>
        </form>

        <CalibrationView data={data} />
      </section>
    </>
  );
}

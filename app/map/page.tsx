import { isAdmin, isPreview } from '@/lib/auth';
import { getEditContext } from '@/lib/content';
import {
  getHypotheses, getAsOf, getArgumentGapScan, reconcileArgumentGapScan, getTargets,
  getCalibration,
} from '@/lib/data';
import {
  diagnoseArgumentGapsAction, dismissArgumentGapAction, clearArgumentGapScanAction,
} from '@/lib/actions';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ShareNotice from '@/components/ShareNotice';
import ArgumentGapPanel from '@/components/ArgumentGapPanel';
import HypothesisDraftBox from '@/components/HypothesisDraftBox';
import HypothesisRow from '@/components/HypothesisRow';
import ConvictionMovementPanel from '@/components/dashboard/ConvictionMovementPanel';

export const dynamic = 'force-dynamic';
// Hosts the AI gap-diagnosis action (admin).
export const maxDuration = 60;
export const metadata = { title: 'Hypotheses · The Strategy Atlas' };

// The Hypothesis Board: the tracked hypotheses as a ledger. Admin gets the
// draft box (create), the conviction chips per row, the recent-moves panel,
// and the atlas-wide gap diagnosis; guests get statements, tests, and public
// evidence tallies (the conviction layer is stripped server-side).
export default async function HypothesisBoard() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();

  const [active, retired, asOf, calibration] = await Promise.all([
    getHypotheses(personal, { status: 'active' }),
    personal ? getHypotheses(personal, { status: 'retired' }) : Promise.resolve([]),
    getAsOf(),
    personal ? getCalibration() : Promise.resolve(null),
  ]);

  // The persisted atlas-wide gap scan (admin-only), reconciled so a recommendation
  // whose code has since become a live hypothesis never resurfaces.
  let gapScan = null;
  if (personal) {
    const [scan, { hypotheses }] = await Promise.all([getArgumentGapScan(), getTargets()]);
    gapScan = reconcileArgumentGapScan(scan, new Set(hypotheses.map((t) => t.code)));
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap">
        <header className="pagehead">
          <Editable
            as="h1"
            k="home.hero.title"
            value={txt('home.hero.title', 'Hypotheses')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            multiline
            k="home.hero.lede"
            value={txt(
              'home.hero.lede',
              'The tracked hypotheses: each with its falsification test, its evidence, and the conviction the team has committed to it.'
            )}
            editing={editing}
          />
        </header>

        {!personal && <ShareNotice asOf={asOf} />}

        {personal && <HypothesisDraftBox />}

        {personal && (
          <ArgumentGapPanel
            initial={gapScan}
            diagnose={diagnoseArgumentGapsAction}
            dismiss={dismissArgumentGapAction}
            clear={clearArgumentGapScanAction}
          />
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: personal && calibration ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
            gap: 24,
            alignItems: 'start',
            paddingBottom: 80,
          }}
        >
          <div>
            <div className="section-label" style={{ marginBottom: 10 }}>
              Active hypotheses · {active.length}
            </div>
            {active.length === 0 ? (
              <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
                No hypotheses yet{personal ? ': draft the first one above.' : '.'}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {active.map((h) => (
                  <HypothesisRow key={h.id} hypothesis={h} admin={personal} />
                ))}
              </div>
            )}

            {personal && retired.length > 0 && (
              <>
                <div className="section-label" style={{ margin: '26px 0 10px' }}>
                  Retired · {retired.length}
                </div>
                <div className="flex flex-col gap-2" style={{ opacity: 0.7 }}>
                  {retired.map((h) => (
                    <HypothesisRow key={h.id} hypothesis={h} admin={personal} />
                  ))}
                </div>
              </>
            )}
          </div>

          {personal && calibration && <ConvictionMovementPanel moves={calibration.moves} />}
        </div>
      </section>
    </>
  );
}

import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getEditContext } from '@/lib/content';
import {
  getQuestions, getAsOf, getArgumentGapScan, reconcileArgumentGapScan, getTargets,
  getLatestThesisReports, getThesisDesk, getTopClaims, getCalibration,
} from '@/lib/data';
import {
  diagnoseArgumentGapsAction, dismissArgumentGapAction, clearArgumentGapScanAction,
} from '@/lib/actions';
import Header from '@/components/Header';
import QuestionCard from '@/components/QuestionCard';
import Editable from '@/components/Editable';
import ShareNotice from '@/components/ShareNotice';
import ArgumentGapPanel from '@/components/ArgumentGapPanel';
import ThesisStrip from '@/components/ThesisStrip';
import ThesisTracker from '@/components/dashboard/ThesisTracker';
import TopClaimsPanel from '@/components/dashboard/TopClaimsPanel';
import ConfidenceMovementPanel from '@/components/dashboard/ConfidenceMovementPanel';

export const dynamic = 'force-dynamic';
// Hosts the AI gap-diagnosis action (admin).
export const maxDuration = 60;
export const metadata = { title: 'Claims & Theses · The AI Atlas' };

// Claims & Theses (the lobby's third tile), layered as the deal workflow reads:
// the standing THESES first (the entry: how a strategist thinks), the CLAIMS
// ledger beneath them (the proof layer), then THE FRAME (the six questions the
// claims settle on, plus the map-wide gap diagnosis for admins). The admin
// thesis desk shows every active thesis and links the workflow page; guests
// keep the report-anchored tracker (guest-safe by construction).
export default async function ArgumentMap() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();

  const [questions, asOf, topClaims, guestTheses, desk, calibration] = await Promise.all([
    getQuestions(personal),
    getAsOf(),
    getTopClaims(personal, 10),
    personal ? Promise.resolve([]) : getLatestThesisReports(8),
    personal ? getThesisDesk() : Promise.resolve([]),
    personal ? getCalibration() : Promise.resolve(null),
  ]);

  // The persisted map-wide gap scan (admin-only), reconciled so a recommendation
  // whose code has since become a live claim/bridge never resurfaces.
  let gapScan = null;
  if (personal) {
    const [scan, { claims, bridges }] = await Promise.all([getArgumentGapScan(), getTargets()]);
    gapScan = reconcileArgumentGapScan(scan, new Set([...claims, ...bridges].map((t) => t.code)));
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap">
        <header className="pagehead">
          <Editable
            as="h1"
            k="home.hero.title"
            value={txt('home.hero.title', 'Claims & Theses')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            multiline
            k="home.hero.lede"
            value={txt(
              'home.hero.lede',
              'The standing theses, the falsifiable claims they stand on, and the six open questions where those claims settle.'
            )}
            editing={editing}
          />
        </header>

        {!personal && <ShareNotice asOf={asOf} />}

        {/* 1 · Theses: the hypotheses being tracked. Admin sees every active
            thesis (desk cards -> the workflow page); guests see the latest
            public report per thesis. */}
        <div className="bs" style={{ marginBottom: 34 }}>
          {personal ? (
            <ThesisStrip entries={desk} />
          ) : (
            <ThesisTracker entries={guestTheses} admin={false} />
          )}
        </div>

        {/* 2 · Claims: the ledger. Evidence counts are public; the confidence
            word and the move log are personal-layer (stripped/withheld). */}
        <div className="bs" style={{ marginBottom: 34 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: personal && calibration ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
              gap: 24,
              alignItems: 'start',
            }}
          >
            <TopClaimsPanel claims={topClaims} personal={personal} />
            {personal && calibration && <ConfidenceMovementPanel moves={calibration.moves} />}
          </div>
        </div>

        {/* 3 · The frame: the six questions the claims settle on. */}
        <div className="section-label bs-colhead" style={{ marginBottom: 12 }}>
          The frame · six questions
          <span style={{ display: 'inline-flex', gap: 14 }}>
            <Link href="/bridges">Bridges →</Link>
            <Link href="/concepts">Concepts →</Link>
          </span>
        </div>

        {personal && (
          <ArgumentGapPanel
            initial={gapScan}
            diagnose={diagnoseArgumentGapsAction}
            dismiss={dismissArgumentGapAction}
            clear={clearArgumentGapScanAction}
          />
        )}

        <main className="qgrid" style={{ paddingBottom: 80 }}>
          {questions.map((qq) => (
            <QuestionCard key={qq.id} q={qq} admin={personal} />
          ))}
        </main>
      </section>
    </>
  );
}

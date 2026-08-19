import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import {
  getTopClaims, getTopSignals, getMapHealth, getPipelineAnalytics, getCandidateArchive, getCalibration,
  getLatestSavedReport, getLatestThesisReports,
} from '@/lib/data';
import { formatDateRange } from '@/lib/format';
import Header from '@/components/Header';
import TopClaimsPanel from '@/components/dashboard/TopClaimsPanel';
import TopSignalsPanel from '@/components/dashboard/TopSignalsPanel';
import MapHealthStrip from '@/components/dashboard/MapHealthStrip';
import ConfidenceMovementPanel from '@/components/dashboard/ConfidenceMovementPanel';
import PipelineAnalyticsView from '@/components/dashboard/PipelineAnalytics';
import CandidateArchive from '@/components/dashboard/CandidateArchive';
import ThesisTracker from '@/components/dashboard/ThesisTracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // hosts the candidate-archive read action
export const metadata = { title: 'News Blotter · The AI Atlas' };

// The News Blotter: the editor's desk, set in the Console Broadsheet voice
// (app/styles/home.css, everything scoped under .bs). This WAS the home page until
// the lobby redesign (2026-08-13); it moved here wholesale: masthead + heavy rule,
// the almanac index strip, the latest report as the lead story, the claims ledger
// and signal wire as ruled editorial columns, then the pipeline business section.
// Public surface (the proxy allow-lists `/blotter`): guests see the same page with
// the personal layer stripped.
export default async function Blotter() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  const [topClaims, topSignals, health, pipeline, archive, calibration, latest, theses] = await Promise.all([
    getTopClaims(personal, 6),
    getTopSignals(6),
    getMapHealth(personal),
    getPipelineAnalytics(),
    getCandidateArchive({ page: 1, pageSize: 25 }),
    personal ? getCalibration() : Promise.resolve(null),
    getLatestSavedReport(),
    getLatestThesisReports(2),
  ]);

  // The lead story's dek: a short plain-text preview of the latest report's period summary.
  const latestPreview = (() => {
    const macro = latest?.report.narrative.macroSurvey ?? '';
    const plain = macro.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return plain.length > 260 ? `${plain.slice(0, 260).trimEnd()}…` : plain;
  })();
  // Legacy auto-titles fall back to a dated name, like ReportReadView.
  const leadHed = latest && !latest.title.startsWith('AI Atlas')
    ? latest.title
    : latest ? `The Fortnight In Signals` : null;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <>
      <Header admin={admin} />
      <section className="wrap bs" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        {/* The brand lives in the site nav; the masthead line carries motto + dateline. */}
        <h1 className="sr-only">News Blotter</h1>
        <div className="bs-masthead">
          <span className="bs-motto">Orientation, not proof.</span>
          <span className="bs-date">{today} · Issue {health.signalsPublished}</span>
        </div>
        <div className="bs-rule2" />

        <MapHealthStrip health={health} />

        {latest && (
          <Link href={`/reports/${latest.id}`} className="bs-lead">
            <div className="section-label">
              The Fortnight Report · {formatDateRange(latest.report.range.from, latest.report.range.to)}
            </div>
            <h2 className="bs-hed">{leadHed}</h2>
            {latestPreview && <p className="bs-dek">{latestPreview}</p>}
            <span className="bs-cta">Read the report →</span>
          </Link>
        )}

        <ThesisTracker entries={theses} admin={personal} />

        <div className="bs-cols" style={{ marginTop: 4 }}>
          <TopClaimsPanel claims={topClaims} personal={personal} />
          <TopSignalsPanel signals={topSignals} />
        </div>

        {/* The personal-layer pulse: recent confidence moves (admin-only). */}
        {personal && calibration && (
          <div style={{ marginTop: 'var(--gap)' }}>
            <ConfidenceMovementPanel moves={calibration.moves} />
          </div>
        )}

        {/* DEFERRED additional dashboard proposals — supported by existing tables, but each
            reads as an empty grid until the corpus grows, so they're held back for now:
            B — Snapshot band trend (snapshots): admin distribution of confidence bands across
                recent snapshots. Source: getCalibration().snapshots. Exists once moves accumulate.
            D — Lens coverage of the map (node_lenses): how many nodes carry each argument-map
                lens — where the map is thin by lens. Source: getLensIndex(). Exists today.
            E — Significance × lens heat grid (signals): a 3×6 grid of published-signal counts by
                significance × audience lens. Source: getSignals(). Meaningful after more signals. */}

        <div className="section-label">Discovery pipeline</div>
        <PipelineAnalyticsView data={pipeline} />

        <div className="section-label">Candidate archive</div>
        <CandidateArchive initial={archive} admin={personal} />
      </section>
    </>
  );
}

import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import { isPreview } from '@/lib/auth';
import {
  getTopClaims, getTopSignals, getMapHealth, getPipelineAnalytics, getCandidateArchive, getCalibration,
  getLatestSavedReport, getLatestThesisReports, getNavCounts,
} from '@/lib/data';
import { formatDateRange } from '@/lib/format';
import PageTop from '@/components/PageTop';
import TopClaimsPanel from '@/components/dashboard/TopClaimsPanel';
import TopSignalsPanel from '@/components/dashboard/TopSignalsPanel';
import MapHealthStrip from '@/components/dashboard/MapHealthStrip';
import ConfidenceMovementPanel from '@/components/dashboard/ConfidenceMovementPanel';
import PipelineAnalyticsView from '@/components/dashboard/PipelineAnalytics';
import CandidateArchive from '@/components/dashboard/CandidateArchive';
import ThesisTracker from '@/components/dashboard/ThesisTracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // hosts the candidate-archive read action
export const metadata = { title: 'Desk · The AI Atlas' };

// The Desk: the editor's own dashboard, moved here verbatim from /blotter
// (2026-09-23) when that route became the public daily edition. Same reads,
// same components, same .bs markup; only the masthead line is now the shared
// PageTop grammar. Map health, the discovery pipeline, and the candidate
// archive are the maintainer's business, not news, so this stays admin-only.
export default async function BlotterDesk() {
  const gate = await adminGate('/blotter/desk', 'Desk');
  if (gate) return gate;
  const admin = true as const;
  const preview = await isPreview();
  const personal = admin && !preview;

  const [topClaims, topSignals, health, pipeline, archive, calibration, latest, theses, counts] = await Promise.all([
    getTopClaims(personal, 6),
    getTopSignals(6),
    getMapHealth(personal),
    getPipelineAnalytics(),
    getCandidateArchive({ page: 1, pageSize: 25 }),
    personal ? getCalibration() : Promise.resolve(null),
    getLatestSavedReport(),
    getLatestThesisReports(2),
    getNavCounts().catch(() => null),
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

  return (
    <>
      <section className="wrap bs" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <PageTop
          pathname="/blotter/desk"
          label="Desk"
          viewer={{ admin, portal: true }}
          counts={counts}
        />

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

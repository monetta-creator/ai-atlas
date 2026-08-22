import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import {
  getTopHypotheses, getTopSignals, getMapHealth, getCandidateArchive, getCalibration,
  getLatestSavedReport, getLatestHypothesisReports,
} from '@/lib/data';
import { formatDateRange, dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import TopHypothesesPanel from '@/components/dashboard/TopHypothesesPanel';
import TopSignalsPanel from '@/components/dashboard/TopSignalsPanel';
import MapHealthStrip from '@/components/dashboard/MapHealthStrip';
import ConvictionMovementPanel from '@/components/dashboard/ConvictionMovementPanel';
import CandidateArchive from '@/components/dashboard/CandidateArchive';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'News Blotter · The Strategy Atlas' };

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

  const [topHypotheses, topSignals, health, archive, calibration, latest, hypothesisReports] = await Promise.all([
    getTopHypotheses(personal, 6),
    getTopSignals(6),
    getMapHealth(personal),
    getCandidateArchive({ page: 1, pageSize: 25 }),
    personal ? getCalibration() : Promise.resolve(null),
    getLatestSavedReport(),
    getLatestHypothesisReports(2),
  ]);

  // The lead story's dek: a short plain-text preview of the latest report's period summary.
  const latestPreview = (() => {
    const macro = latest?.report.narrative.macroSurvey ?? '';
    const plain = macro.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return plain.length > 260 ? `${plain.slice(0, 260).trimEnd()}…` : plain;
  })();
  // Legacy auto-titles fall back to a dated name, like ReportReadView.
  const leadHed = latest && !latest.title.startsWith('Strategy Atlas')
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

        {/* Latest hypothesis reports */}
        {hypothesisReports.length > 0 && (
          <div style={{ margin: '10px 0 14px' }}>
            <div className="section-label">Hypothesis reports</div>
            <div className="flex flex-col gap-1.5">
              {hypothesisReports.map((t) => (
                <Link key={t.report_id} href={`/hypothesis-report/${t.report_id}`} className="bs-row" style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span className="bs-rowhed" style={{ flex: 1 }}>{t.statement}</span>
                  <span className="bs-tags">
                    {t.matched} matched · {t.supports}s/{t.contradicts}c
                    {dateLabel(t.generated_at) ? ` · ${dateLabel(t.generated_at)}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="bs-cols" style={{ marginTop: 4 }}>
          <TopHypothesesPanel hypotheses={topHypotheses} personal={personal} />
          <TopSignalsPanel signals={topSignals} />
        </div>

        {/* The personal-layer pulse: recent conviction moves (admin-only). */}
        {personal && calibration && (
          <div style={{ marginTop: 'var(--gap)' }}>
            <ConvictionMovementPanel moves={calibration.moves} />
          </div>
        )}

        <div className="section-label">Candidate archive</div>
        <CandidateArchive initial={archive} admin={personal} />
      </section>
    </>
  );
}

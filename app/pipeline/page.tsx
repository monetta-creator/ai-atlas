import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getRuns, getCandidates, getTextCoverage } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import Header from '@/components/Header';
import PipelineConsole from '@/components/PipelineConsole';
import PipelineCandidates from '@/components/PipelineCandidates';
import TextGuardPanel from '@/components/TextGuardPanel';

export const dynamic = 'force-dynamic';
// Hosts the discovery/analysis server actions; each unit call must fit the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Discovery pipeline · The AI Atlas' };

export default async function PipelinePage() {
  const admin = await isAdmin();
  if (!admin) redirect('/login');

  const [runs, textCoverage] = await Promise.all([getRuns(15), getTextCoverage()]);
  const latest = runs[0] ?? null;
  const candidates = latest ? await getCandidates(latest.id) : [];
  const pendingAnalysisIds = candidates
    .filter((c) => c.triage_status === 'approved' && !c.signal_id)
    .map((c) => c.id);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead">
          <h1>Discovery pipeline</h1>
          <p className="lede">
            Discover → triage → analyze candidate developments into draft signals. Review and publish
            on the <Link href="/signals">Signal Board</Link>.
          </p>
        </header>

        <PipelineConsole latestRun={latest} pendingAnalysisIds={pendingAnalysisIds} />

        {/* The full-text guarantee, audited: retained-text coverage over the
            published corpus, with the catch-up refetch when anything is missing. */}
        <TextGuardPanel initial={textCoverage} />

        {/* Post-run coverage check (advisory): what the window's press cycle considered
            significant, and whether this run's funnel accounted for it. */}
        {latest?.coverage && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">
              Coverage check · since {latest.coverage.since} ·{' '}
              {latest.coverage.developments.filter((d) => !d.covered).length} possible miss(es) of{' '}
              {latest.coverage.developments.length}
            </div>
            <div className="flex flex-col gap-1">
              {latest.coverage.developments.map((d, i) => (
                <div
                  key={i}
                  className="flex items-baseline flex-wrap gap-2 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
                >
                  <span style={{ color: d.covered ? 'var(--supports)' : 'var(--heat-4)', fontFamily: 'var(--font-mono)' }}>
                    {d.covered ? '✓ covered' : '⚠ possible miss'}
                  </span>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>
                      {d.headline}
                    </a>
                  ) : (
                    <span style={{ color: 'var(--ink)' }}>{d.headline}</span>
                  )}
                  {d.covered && d.matched && (
                    <span style={{ color: 'var(--faint-ink)' }}>matches: {d.matched}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Candidate review for the latest run */}
        {latest && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">
              Latest run · {candidates.length} candidates ·{' '}
              {latest.approved_count} approved · {latest.signal_count} drafts · {latest.step}
            </div>
            <PipelineCandidates candidates={candidates} runId={latest.id} />
          </section>
        )}

        {/* Run history */}
        {runs.length > 0 && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">Run history</div>
            <div className="flex flex-col gap-1">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{timeAgo(r.triggered_at)}</span>
                  <span>· {r.cadence}</span>
                  <span style={{ color: r.status === 'failed' ? 'var(--heat-4)' : r.status === 'completed' ? 'var(--supports)' : 'var(--dim)' }}>
                    · {r.status} ({r.step})
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {r.candidate_count} found · {r.approved_count} approved · {r.signal_count} drafts
                  </span>
                  {r.error && <span style={{ color: 'var(--heat-4)', width: '100%' }}>{r.error}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </>
  );
}

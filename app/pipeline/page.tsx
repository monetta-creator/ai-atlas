import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getRuns, getCandidates, getTextCoverage, listSignalsMissingText } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import Header from '@/components/Header';
import PipelineConsole from '@/components/PipelineConsole';
import PipelineCandidates from '@/components/PipelineCandidates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake pipeline · The Atlas' };

export default async function PipelinePage() {
  const admin = await requireAdminPage();

  const [runs, textCoverage, missingText] = await Promise.all([
    getRuns(15), getTextCoverage(), listSignalsMissingText(5),
  ]);
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
          <h1>Intake pipeline</h1>
          <p className="lede">
            Triage → analyze candidate items into draft signals. Candidates enter from a
            source page (Turn into signal) with their text retained at intake. Review and
            publish on the <Link href="/signals">Signal Board</Link>.
          </p>
        </header>

        <PipelineConsole latestRun={latest} pendingAnalysisIds={pendingAnalysisIds} />

        {/* Retained-text coverage over the published corpus (display-only). A signal
            missing text is a legacy gap: re-add the document text on its source. */}
        <section style={{ marginTop: 8 }}>
          <div className="section-label">
            Retained text · {textCoverage.with_text}/{textCoverage.total} published signals carry full text
          </div>
          {missingText.length > 0 && (
            <div className="flex flex-col gap-1">
              {missingText.map((r) => (
                <div
                  key={r.signal_id}
                  className="flex items-baseline flex-wrap gap-2 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
                >
                  <span style={{ color: 'var(--heat-4)', fontFamily: 'var(--font-mono)' }}>⚠ no text</span>
                  <Link href={`/signals/${r.signal_id}`} style={{ color: 'var(--ink)' }}>{r.title}</Link>
                  {r.source_id && (
                    <Link href={`/source/${r.source_id}`} style={{ color: 'var(--faint-ink)' }}>
                      add text on the source →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

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

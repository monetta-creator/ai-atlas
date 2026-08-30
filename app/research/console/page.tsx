import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import {
  getResearchRuns, getReviewQueuePapers, countPendingPapers,
  getResearchThreads, getThreadScan, reconcileThreadScan, getRisingRejects,
  getFindingCoverage, getSteeringNote, getAllPendingPaperIds, getAgentQueueSummary,
} from '@/lib/data';
import { createThreadFormAction } from '@/lib/actions';
import { timeAgo } from '@/lib/format';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ResearchConsole from '@/components/ResearchConsole';
import PaperReviewList from '@/components/PaperReviewList';
import AddPaperForm from '@/components/AddPaperForm';
import ThreadScanPanel from '@/components/ThreadScanPanel';
import CitationsPanel from '@/components/CitationsPanel';
import FindingCoveragePanel from '@/components/FindingCoveragePanel';
import QueueAgentPanel from '@/components/QueueAgentPanel';

export const dynamic = 'force-dynamic';
// Hosts the pull/triage server actions; each unit call must fit the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Research console · The AI Atlas' };

// The research WORKBENCH (admin): runs, the review queue, manual adds, thread
// tools, citation self-correction, run history. Moved out of /research on
// 2026-08-14 so the portal proper leads with insights instead of the factory
// (the /reports/period pattern). Every server action re-checks requireAdmin().
export default async function ResearchConsolePage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [runs, queue, rising, rawScan, threads, coverage, steering, unprocessed, agentSummary] = await Promise.all([
    getResearchRuns(15), getReviewQueuePapers(), getRisingRejects(), getThreadScan(),
    getResearchThreads(), getFindingCoverage(), getSteeringNote(), getAllPendingPaperIds(),
    getAgentQueueSummary(),
  ]);
  const latest = runs[0] ?? null;
  const pendingTriage = latest ? await countPendingPapers(latest.id) : 0;
  const scan = reconcileThreadScan(rawScan, new Set(threads.map((t) => t.slug)));

  // The agent's recommendations turn the queue into a decision surface: track
  // candidates first (confidence desc), then notes, unprocessed, and dismissals
  // last (grouped visually by their cluster label on the cards).
  const RECOMMENDATION_ORDER: Record<string, number> = { tracked: 0, noted: 1, dismissed: 3 };
  const sortedQueue = [...queue].sort((a, b) => {
    const oa = a.agent_recommendation ? RECOMMENDATION_ORDER[a.agent_recommendation] ?? 2 : 2;
    const ob = b.agent_recommendation ? RECOMMENDATION_ORDER[b.agent_recommendation] ?? 2 : 2;
    if (oa !== ob) return oa - ob;
    if (oa === 3 && a.agent_cluster !== b.agent_cluster) {
      return (a.agent_cluster ?? '').localeCompare(b.agent_cluster ?? '');
    }
    return (b.agent_confidence ?? 0) - (a.agent_confidence ?? 0);
  });

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <Editable
            as="h1"
            style={{ marginBottom: 10 }}
            k="research-console.title"
            value={txt('research-console.title', 'Research console')}
            editing={editing}
          />
          <p className="lede" style={{ marginBottom: 20 }}>
            The working side of the Research Portal: pull and triage arXiv, review the queue,
            tend the threads. The reading surface lives at <Link href="/research">/research</Link>.
          </p>
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#run" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Run</a>
            <a href="#agent" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>✦ Agent</a>
            <a href="#queue" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
              Queue <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{queue.length}</span>
            </a>
            {coverage.missing.length > 0 && (
              <a href="#findings" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
                Findings <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{coverage.missing.length}</span>
              </a>
            )}
            <a href="#add" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Add paper</a>
            <a href="#threads" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Thread tools</a>
            <a href="#citations" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Citations</a>
            {runs.length > 0 && <a href="#history" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>History</a>}
          </nav>
        </header>

        <div id="run" style={{ scrollMarginTop: 80 }}>
          <ResearchConsole latestRun={latest} pendingTriage={pendingTriage} />
        </div>

        <section id="findings" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Findings coverage · the reviewed shelf</div>
          <FindingCoveragePanel
            reviewed={coverage.reviewed}
            withFinding={coverage.withFinding}
            missing={coverage.missing}
          />
        </section>

        <section id="agent" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Queue agent · recommend-only</div>
          <QueueAgentPanel steering={steering} unprocessed={unprocessed} summary={agentSummary} />
        </section>

        <section id="queue" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Review queue · {queue.length} paper{queue.length === 1 ? '' : 's'}</div>
          <PaperReviewList papers={sortedQueue} />
        </section>

        <section id="add" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Add a paper manually</div>
          <AddPaperForm />
        </section>

        <section id="threads" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Thread tools</div>
          <details>
            <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
              New thread…
            </summary>
            <form
              action={createThreadFormAction}
              className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 560 }}
            >
              <div className="field">
                <label htmlFor="thread-slug">Slug (kebab-case)</label>
                <input id="thread-slug" name="slug" className="input" required pattern="[a-z0-9][a-z0-9-]+" />
              </div>
              <div className="field">
                <label htmlFor="thread-title">Title (the question as a phrase)</label>
                <input id="thread-title" name="title" className="input" required />
              </div>
              <div className="field">
                <label htmlFor="thread-question">Question (one sentence)</label>
                <input id="thread-question" name="question" className="input" required />
              </div>
              <div>
                <button type="submit" className="btn btn--primary btn--sm">Create thread</button>
              </div>
            </form>
          </details>
          {scan && (
            <div style={{ marginTop: 12 }}>
              <ThreadScanPanel scan={scan} />
            </div>
          )}
        </section>

        <section id="citations" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Citation self-correction</div>
          <CitationsPanel rising={rising} />
        </section>

        {runs.length > 0 && (
          <section id="history" style={{ marginTop: 8, scrollMarginTop: 80 }}>
            <div className="section-label">Run history</div>
            <div className="flex flex-col gap-1">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{timeAgo(r.triggered_at)}</span>
                  <span>· since {r.since_date}</span>
                  <span style={{ color: r.status === 'failed' ? 'var(--heat-4)' : r.status === 'completed' ? 'var(--supports)' : 'var(--dim)' }}>
                    · {r.status} ({r.step})
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {r.scanned_count} scanned · {r.pulled_count} pulled · {r.kept_count} kept · {r.rejected_count} rejected
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

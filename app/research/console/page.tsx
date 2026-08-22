import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import {
  getReviewQueuePapers,
  getResearchThreads, getThreadScan, reconcileThreadScan,
  getSteeringNote, getAllPendingPaperIds, getAgentQueueSummary,
} from '@/lib/data';
import { createThreadFormAction } from '@/lib/actions';
import Header from '@/components/Header';
import PaperReviewList from '@/components/PaperReviewList';
import AddPaperForm from '@/components/AddPaperForm';
import ThreadScanPanel from '@/components/ThreadScanPanel';
import QueueAgentPanel from '@/components/QueueAgentPanel';

export const dynamic = 'force-dynamic';
// Hosts the review/analysis server actions (model calls).
export const maxDuration = 60;
export const metadata = { title: 'Research console · The Atlas' };

// The research WORKBENCH (admin): the review queue, manual adds, thread tools.
// Papers enter by hand or from a curated source page (Send to research) — there
// is no automated pull. Every server action re-checks requireAdmin().
export default async function ResearchConsolePage() {
  const admin = await requireAdminPage();

  const [queue, rawScan, threads, steering, unprocessed, agentSummary] = await Promise.all([
    getReviewQueuePapers(), getThreadScan(),
    getResearchThreads(), getSteeringNote(), getAllPendingPaperIds(),
    getAgentQueueSummary(),
  ]);
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
          <h1 style={{ marginBottom: 10 }}>Research console</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            The working side of the Research Portal: review the queue, add papers, tend
            the threads. The reading surface lives at <Link href="/research">/research</Link>.
          </p>
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#agent" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>✦ Agent</a>
            <a href="#queue" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
              Queue <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{queue.length}</span>
            </a>
            <a href="#add" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Add paper</a>
            <a href="#threads" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Thread tools</a>
          </nav>
        </header>

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
      </section>
    </>
  );
}

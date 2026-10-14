import { adminGate } from '@/lib/admin-gate';
import {
  getResearchPrefs, getResearchQueueStats, getSprintPapers, getTargets, getThreadDigest,
  getSteeringNote, getAllPendingPaperIds, getAgentQueueSummary, getNavCounts,
} from '@/lib/data';
import { getEditContext } from '@/lib/content';
import PageTop from '@/components/PageTop';
import Editable from '@/components/Editable';
import ResearchQueueBar from '@/components/research/ResearchQueueBar';
import PaperSprint from '@/components/research/PaperSprint';
import QueueAgentPanel from '@/components/QueueAgentPanel';
import PaperReviewList from '@/components/PaperReviewList';

export const dynamic = 'force-dynamic';
// Hosts the queue agent's chunk action and the accept-tracks chain (hydrate +
// analyze per paper); each call fits the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Research review desk · The AI Atlas' };

// The research review desk (admin, migration 0082): the signal draft desk's
// shape applied to papers. The backlog bar clears what needs no reading (the
// auto-dismiss policy and the judgment-free cuts), the sprint walks the rest
// one paper at a time, and the queue agent's steering and fresh pass sit
// below, with the old card list behind a details block.
export default async function ResearchQueuePage() {
  const gate = await adminGate('/research/queue', 'Review desk');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const prefs = await getResearchPrefs();
  const [stats, papers, targets, threadDigest, steering, unprocessed, agentSummary] = await Promise.all([
    getResearchQueueStats(prefs),
    getSprintPapers(400),
    getTargets(),
    getThreadDigest(),
    getSteeringNote(),
    getAllPendingPaperIds(),
    getAgentQueueSummary(),
  ]);
  const counts = await countsP;

  const statements: Record<string, string> = {};
  for (const t of [...targets.claims, ...targets.bridges]) statements[t.code] = t.statement;
  const threads: Record<string, string> = {};
  for (const t of threadDigest) threads[t.slug] = t.title;

  return (
    <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
      <PageTop
        pathname="/research/queue"
        label="Review desk"
        viewer={{ admin, portal: admin }}
        counts={counts}
        title={
          <Editable
            as="h1"
            k="research-queue.title"
            value={txt('research-queue.title', 'Review desk')}
            editing={editing}
          />
        }
      />

      <ResearchQueueBar
        stats={stats}
        policy={{
          autoDismiss: prefs.auto_dismiss,
          minConfidence: prefs.auto_dismiss_min_confidence,
          staleDays: prefs.stale_days,
        }}
      />

      <div className="section-label" style={{ marginTop: 24 }}>Review sprint · agent track picks first</div>
      <PaperSprint papers={papers} statements={statements} threads={threads} />

      <details className="ds-list" style={{ marginTop: 34 }}>
        <summary>Queue agent: the steering note and a fresh pass over the queue</summary>
        <div style={{ marginTop: 14 }}>
          <QueueAgentPanel steering={steering} unprocessed={unprocessed} summary={agentSummary} />
        </div>
      </details>

      <details className="ds-list" style={{ marginTop: 18 }}>
        <summary>Full list, the first 100 papers as cards</summary>
        <div style={{ marginTop: 14 }}>
          <PaperReviewList papers={papers.slice(0, 100).map((p) => ({ ...p, raw_content: null }))} />
        </div>
      </details>
    </section>
  );
}

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
import TriageToCapPanel from '@/components/research/TriageToCapPanel';
import { queueAgentModel } from '@/lib/research/queue-agent';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import QueueAgentPanel from '@/components/QueueAgentPanel';
import PaperReviewList from '@/components/PaperReviewList';
import ApplyMigrationsButton from '@/components/research/ApplyMigrationsButton';
import { getPendingMigrations } from '@/lib/migrations';

export const dynamic = 'force-dynamic';
// Hosts the queue agent's chunk action, the accept-tracks chain, and the
// "triage down to N" pass, whose read batch runs eight 12-paper agent calls
// concurrently (each bounded at 90s) and whose pick call is bounded at 90s.
export const maxDuration = 300;
export const metadata = { title: 'Research review desk · The AI Atlas' };

// Papers the sprint loads per page view (each carries its abstract and
// finding); the empty state offers the next batch while the queue is bigger.
const SPRINT_LOAD = 400;

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

  // The reads depend on migrations 0082/0083. A production error arrives as
  // an opaque digest, so this admin-only page shows the database's own
  // message instead (a missing column means the migrations never ran here).
  let loaded;
  try {
    const prefs = await getResearchPrefs();
    loaded = [prefs, ...(await Promise.all([
      getResearchQueueStats(prefs),
      getSprintPapers(SPRINT_LOAD),
      getTargets(),
      getThreadDigest(),
      getSteeringNote(),
      getAllPendingPaperIds(),
      getAgentQueueSummary(),
    ]))] as const;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const pending = await getPendingMigrations().catch(() => [] as string[]);
    return (
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop pathname="/research/queue" label="Review desk" viewer={{ admin, portal: admin }} counts={await countsP} title="Review desk" />
        <div className="dbb">
          <p className="dbb-note" style={{ color: 'var(--heat-4)' }}>The review desk could not read the database: {message}</p>
          {pending.length > 0 ? (
            <>
              <p className="dbb-muted" style={{ margin: 0 }}>
                This deploy carries {pending.length} migration{pending.length === 1 ? '' : 's'} the database has not applied yet.
                Applying runs each file in its own transaction and stops at the first failure.
              </p>
              <ApplyMigrationsButton pending={pending} />
            </>
          ) : (
            <p className="dbb-muted" style={{ margin: 0 }}>
              No pending migration files were found for this deploy. Run npm run db:migrate from an up-to-date
              checkout of main against the production database.
            </p>
          )}
        </div>
      </section>
    );
  }
  const [prefs, stats, papers, targets, threadDigest, steering, unprocessed, agentSummary] = loaded;
  const counts = await countsP;

  // The model that reads the queue (the console's triage pick, else GLM-5.3
  // Flash when OpenRouter is configured, else the Haiku fallback).
  const readerId = queueAgentModel(prefs.triage_model) ?? 'claude-haiku-4-5';
  const modelLabel = SCAN_ENRICH_MODELS.find((m) => m.id === readerId)?.label ?? readerId;

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

      <TriageToCapPanel pending={stats.pending} unread={stats.byRec.none} modelLabel={modelLabel} />

      <div className="section-label" style={{ marginTop: 24 }}>Review sprint · agent track picks first</div>
      <PaperSprint papers={papers} total={stats.pending} statements={statements} threads={threads} />

      {/* Open while the agent has unread papers: reading them is step one of a backlog. */}
      <details className="ds-list" style={{ marginTop: 34 }} open={agentSummary.none > 0}>
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

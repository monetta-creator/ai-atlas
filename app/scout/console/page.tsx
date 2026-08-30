import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import {
  getScoutVerticals, getScoutQueue, getScoutRuns,
  getScoutPrefs, getScoutQueueIds, getScoutAgentSummary,
} from '@/lib/data';
import { DEFAULT_RUBRIC } from '@/lib/scout/agent';
import { timeAgo } from '@/lib/format';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ScoutConsole from '@/components/scout/ScoutConsole';
import ScoutAgentPanel from '@/components/scout/ScoutAgentPanel';
import CompanyReviewList from '@/components/scout/CompanyReviewList';
import AddCompanyForm from '@/components/scout/AddCompanyForm';
import VerticalsManager from '@/components/scout/VerticalsManager';

export const dynamic = 'force-dynamic';
// Hosts the review/add/vertical server actions (and, in later phases, the
// discovery batches and the scoring agent); each unit call must fit the cap.
export const maxDuration = 60;
export const metadata = { title: 'Scout console · The AI Atlas' };

// The Scout WORKBENCH (admin): the review queue, manual adds, verticals, run
// history. The reading surface lives at /scout. Every server action re-checks
// requireAdmin().
export default async function ScoutConsolePage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [verticals, queue, runs, prefs, queueIds, agentSummary] = await Promise.all([
    getScoutVerticals(true), getScoutQueue(), getScoutRuns(),
    getScoutPrefs(), getScoutQueueIds(), getScoutAgentSummary(),
  ]);

  // The agent's verdicts turn the queue into a decision surface: pursues first
  // (confidence desc), then watches, unscored, and passes last.
  const VERDICT_ORDER: Record<string, number> = { pursue: 0, watch: 1, pass: 3 };
  const sortedQueue = [...queue].sort((a, b) => {
    const oa = a.agent_verdict ? VERDICT_ORDER[a.agent_verdict] ?? 2 : 2;
    const ob = b.agent_verdict ? VERDICT_ORDER[b.agent_verdict] ?? 2 : 2;
    if (oa !== ob) return oa - ob;
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
            k="scout-console.title"
            value={txt('scout-console.title', 'Scout console')}
            editing={editing}
          />
          <p className="lede" style={{ marginBottom: 20 }}>
            The working side of Startup Scout: review discovered companies, add candidates
            by hand, tend the verticals. The watchlist lives at <Link href="/scout">/scout</Link>.
          </p>
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#run" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Run</a>
            <a href="#agent" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>✦ Agent</a>
            <a href="#queue" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
              Queue <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{queue.length}</span>
            </a>
            <a href="#add" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Add company</a>
            <a href="#verticals" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Verticals</a>
            {runs.length > 0 && <a href="#history" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>History</a>}
          </nav>
        </header>

        <div id="run" style={{ scrollMarginTop: 80 }}>
          <ScoutConsole activeVerticals={verticals.filter((v) => v.active && v.search_queries.length > 0).length} />
        </div>

        <section id="agent" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Scoring agent · recommend-only</div>
          <ScoutAgentPanel
            steering={prefs.steering}
            rubric={prefs.rubric}
            defaultRubric={DEFAULT_RUBRIC}
            queued={queueIds}
            summary={agentSummary}
          />
        </section>

        <section id="queue" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Review queue · {queue.length} compan{queue.length === 1 ? 'y' : 'ies'}</div>
          <CompanyReviewList companies={sortedQueue} verticals={verticals} />
        </section>

        <section id="add" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Add a company manually</div>
          <AddCompanyForm verticals={verticals} />
        </section>

        <section id="verticals" style={{ marginTop: 8, scrollMarginTop: 80 }}>
          <div className="section-label">Verticals · the acquisition thesis</div>
          <VerticalsManager verticals={verticals} />
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
                  <span style={{ color: r.status === 'failed' ? 'var(--heat-4)' : r.status === 'completed' ? 'var(--supports)' : 'var(--dim)' }}>
                    · {r.status} ({r.step})
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {r.found_count} found · {r.new_count} new
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

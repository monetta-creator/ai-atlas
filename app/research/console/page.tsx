import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth';
import {
  getResearchRuns, getReviewQueuePapers, countPendingPapers,
  getResearchThreads, getThreadScan, reconcileThreadScan, getRisingRejects,
  getFindingCoverage, getSteeringNote, getAllPendingPaperIds, getAgentQueueSummary,
  getResearchPrefs, getResearchRunByDay, getResearchHealth, getResearchModelAB,
} from '@/lib/data';
import { createThreadFormAction } from '@/lib/actions';
import { timeAgo } from '@/lib/format';
import { getEditContext } from '@/lib/content';
import { getDataset } from '@/lib/datasets/registry';
import { cronLabel } from '@/lib/datasets/handoff-shared';
import { buildResearchHandoff } from '@/lib/research/handoff';
import vercelConfig from '@/vercel.json';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ResearchConsole from '@/components/ResearchConsole';
import ResearchEnginePanel from '@/components/ResearchEnginePanel';
import ResearchEnabledToggle from '@/components/ResearchEnabledToggle';
import ResearchModelPicker from '@/components/ResearchModelPicker';
import PaperReviewList from '@/components/PaperReviewList';
import AddPaperForm from '@/components/AddPaperForm';
import ThreadScanPanel from '@/components/ThreadScanPanel';
import CitationsPanel from '@/components/CitationsPanel';
import FindingCoveragePanel from '@/components/FindingCoveragePanel';
import QueueAgentPanel from '@/components/QueueAgentPanel';
import CopyHandoff from '@/components/scan/CopyHandoff';
import DatasetPreview from '@/components/datasets/DatasetPreview';

export const dynamic = 'force-dynamic';
// Hosts the pull/triage server actions; each unit call must fit the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Research console · The AI Atlas' };

const panel = { background: 'var(--surface)', borderColor: 'var(--line)' } as const;
const pct = (num: number, den: number): string => (den > 0 ? `${Math.round((num / den) * 100)}%` : '–');

// The research WORKBENCH (admin): OPERATIONS (the day-keyed engine, its
// toggle + model pickers, health, and the firewall export) followed by the
// original workbench (manual runs, the review queue, manual adds, thread
// tools, citation self-correction, run history). Moved out of /research on
// 2026-08-14 so the portal proper leads with insights instead of the factory
// (the /reports/period pattern). Every server action re-checks requireAdmin().
export default async function ResearchConsolePage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [
    runs, queue, rising, rawScan, threads, coverage, steering, unprocessed, agentSummary,
    prefs, todayRun, health, modelStats, h,
  ] = await Promise.all([
    getResearchRuns(15), getReviewQueuePapers(), getRisingRejects(), getThreadScan(),
    getResearchThreads(), getFindingCoverage(), getSteeringNote(), getAllPendingPaperIds(),
    getAgentQueueSummary(),
    getResearchPrefs(), getResearchRunByDay(), getResearchHealth(30), getResearchModelAB(30),
    headers(),
  ]);
  const latest = runs[0] ?? null;
  const pendingTriage = latest ? await countPendingPapers(latest.id) : 0;
  const scan = reconcileThreadScan(rawScan, new Set(threads.map((t) => t.slug)));

  const def = getDataset('research-export');
  const hostName = h.get('host') ?? 'localhost:3000';
  const host = `${hostName.startsWith('localhost') ? 'http' : 'https'}://${hostName}`;
  const allCrons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const researchCrons = allCrons.filter(
    (c) => c.path.startsWith('/api/cron/research') || c.path === '/api/cron/roundup'
  );
  const handoff = def
    ? buildResearchHandoff({
        def, crons: researchCrons, host,
        generatedOn: new Date().toISOString().slice(0, 10),
      })
    : '';
  const completedRuns = Math.max(1, health.runs.completed);

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
            <a href="#engine" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Engine</a>
            <a href="#config" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Config</a>
            <a href="#health" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Health</a>
            <a href="#exports" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Exports</a>
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

        <section id="engine" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">Engine · today&apos;s run</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            {todayRun ? (
              <div className="text-xs" style={{ color: 'var(--dim)', display: 'grid', gap: 4 }}>
                <span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{todayRun.day}</span>
                  {' '}·{' '}
                  <span
                    style={{
                      color:
                        todayRun.status === 'failed' ? 'var(--heat-4)'
                        : todayRun.status === 'completed' ? 'var(--supports)'
                        : 'var(--dim)',
                    }}
                  >
                    {todayRun.status} ({todayRun.step})
                  </span>
                </span>
                <span>
                  scanned {todayRun.scanned_count} · pulled {todayRun.pulled_count} · kept {todayRun.kept_count} · rejected {todayRun.rejected_count}
                </span>
                {todayRun.notes.length > 0 && (
                  <span style={{ color: 'var(--faint-ink)' }}>
                    {todayRun.notes.slice(-3).join(' · ')}
                  </span>
                )}
                {todayRun.error && <span style={{ color: 'var(--heat-4)' }}>{todayRun.error}</span>}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>No engine run yet today.</p>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <ResearchEnginePanel />
          </div>
        </section>

        <section id="config" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Schedule &amp; config</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <ResearchEnabledToggle enabled={prefs.enabled} />
              <span className="text-xs" style={{ color: 'var(--dim)' }}>
                {researchCrons.map((c) => `${cronLabel(c.schedule)} (${c.path})`).join(' · ')}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 12 }}>
              Cron SCHEDULES are deploy-time config (vercel.json, shown live above): changing the
              times is a one-line edit plus a push. The toggle here pauses or resumes what the
              crons actually do; the Friday roundup cron is unaffected by this toggle.
            </p>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <ResearchModelPicker triageModel={prefs.triage_model} analysisModels={prefs.analysis_models} />
            </div>
          </div>
        </section>

        <section id="health" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">History &amp; health</div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
            No day-grid calendar here: the scan console&apos;s day grid hardcodes feed/search/hydrated/
            enriched labels that do not fit the research funnel&apos;s counters (research_runs
            persists no per-day agent or analyze counts), so a faithful version would be more than
            a thin prop mapping. Tiles and tables cover the same ground below.
          </p>

          <div
            style={{
              marginTop: 14, display: 'grid', gap: 'var(--gap, 10px)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            {[
              {
                label: `Runs · ${health.days}d`,
                value: `${health.runs.completed} ok`,
                sub: `${health.runs.failed} failed · ${health.runs.missedDays} missed day${health.runs.missedDays === 1 ? '' : 's'}`,
                warn: health.runs.failed > 0 || health.runs.missedDays > 0,
              },
              {
                label: 'Papers / day',
                value: `${Math.round(health.papers.pulled / completedRuns)}`,
                sub: `${health.papers.pulled} pulled · ${health.papers.kept} kept · ${health.papers.rejected} rejected`,
                warn: false,
              },
              {
                label: 'Kept rate',
                value: pct(health.papers.kept, health.papers.kept + health.papers.rejected),
                sub: `${health.papers.kept} of ${health.papers.kept + health.papers.rejected} triaged`,
                warn: false,
              },
              {
                label: 'Findings coverage',
                value: pct(health.findings.withFinding, health.findings.reviewed),
                sub: `${health.findings.withFinding} of ${health.findings.reviewed} reviewed papers`,
                warn: false,
              },
              {
                label: 'Spend',
                value: `$${health.spendUsd.toFixed(2)}`,
                sub: `$${(health.spendUsd / completedRuns).toFixed(2)} / run`,
                warn: false,
              },
            ].map((t) => (
              <div key={t.label} className="rounded-[var(--radius)] border p-3" style={panel}>
                <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>{t.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: t.warn ? 'var(--heat-4)' : 'var(--ink)', marginTop: 2 }}>
                  {t.value}
                </div>
                <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 2 }}>{t.sub}</div>
              </div>
            ))}
          </div>

          {modelStats.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Model A/B · analyzing model · what the human did with the paper is the real signal
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>model</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>analyzed</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>tracked</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>noted</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>dismissed</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg agent conf.</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg ms</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>$/paper</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>total $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelStats.map((m) => (
                      <tr key={m.model} style={{ color: 'var(--dim)' }}>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                          {m.model}
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.analyzed}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.tracked}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.noted}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.dismissed}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgAgentConfidence === null ? '–' : m.avgAgentConfidence.toFixed(1)}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgWallMs ?? '–'}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.costPerPaper === null ? '–' : `$${m.costPerPaper.toFixed(4)}`}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>${m.costUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {health.issues.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
                Recent issues · {health.issues.length}
              </summary>
              <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 10, display: 'grid', gap: 3 }}>
                {health.issues.map((iss, i) => (
                  <div key={i}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{iss.day}</span>
                    {' '}{iss.note}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        <section id="exports" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Firewall export</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <a className="btn btn--primary" href={`/api/datasets/research-export?format=json&download=1`}>
                Download JSON
              </a>
              <a className="btn" href={`/api/datasets/research-export?format=csv`}>CSV</a>
              <Link className="btn" href="/datasets/research-export">Dataset page</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
              The reviewed shelf (tracked + noted papers) with extraction and retained full text.
              Key-gated, full corpus every download. From a browser without the portal cookie,
              unlock first: <code>{host}/datasets/enter?k=&lt;PORTAL_KEY&gt;</code>, then retry.
            </p>
            {def && (
              <div style={{ marginTop: 12 }}>
                <DatasetPreview slug="research-export" columns={def.columns} />
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <CopyHandoff text={handoff} label="Copy research-export handoff" />
            </div>
            <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>Also public, no key needed:</span>
              <a className="btn" href={`/api/datasets/research-papers?format=json`}>Research papers JSON</a>
              <a className="btn" href={`/api/datasets/research-papers?format=csv`}>CSV</a>
              <Link className="btn" href="/datasets/research-papers">Dataset page</Link>
            </div>
          </div>
        </section>

        <div id="run" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Manual run · the old console flow</div>
          <div style={{ marginTop: 14 }}>
            <ResearchConsole latestRun={latest} pendingTriage={pendingTriage} />
          </div>
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

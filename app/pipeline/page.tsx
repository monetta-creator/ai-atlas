import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import {
  getRuns, getCandidates, getTextCoverage, getPipelinePrefs, getAnalysisModelStats,
} from '@/lib/data';
import { setPipelineAnalysisModelsAction } from '@/lib/actions';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import { timeAgo } from '@/lib/format';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import PipelineConsole from '@/components/PipelineConsole';
import PipelineCandidates from '@/components/PipelineCandidates';
import PipelineEnabledToggle from '@/components/PipelineEnabledToggle';
import EnrichModelPicker from '@/components/scan/EnrichModelPicker';
import TextGuardPanel from '@/components/TextGuardPanel';

export const dynamic = 'force-dynamic';
// Hosts the discovery/analysis server actions; each unit call must fit the 60s cap.
export const maxDuration = 60;
export const metadata = { title: 'Discovery pipeline · The AI Atlas' };

export default async function PipelinePage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [runs, textCoverage, prefs, modelStats] = await Promise.all([
    getRuns(15), getTextCoverage(), getPipelinePrefs(), getAnalysisModelStats(30),
  ]);
  const latest = runs[0] ?? null;
  const modelLabel = new Map(SCAN_ENRICH_MODELS.map((m) => [m.id, m.label]));
  const tavily = Boolean(process.env.TAVILY_API_KEY);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const candidates = latest ? await getCandidates(latest.id) : [];
  const pendingAnalysisIds = candidates
    .filter((c) => c.triage_status === 'approved' && !c.signal_id)
    .map((c) => c.id);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead">
          <Editable
            as="h1"
            k="pipeline.title"
            value={txt('pipeline.title', 'Discovery pipeline')}
            editing={editing}
          />
          <p className="lede">
            Discover → triage → analyze candidate developments into draft signals. Review and publish
            on the <Link href="/signals">Signal Board</Link>.
          </p>
        </header>

        {/* Pipeline 2.0 config: the daily cron leg (shares /api/cron/scan with the
            External Scan), providers, and the analysis A/B model picker. */}
        <section style={{ marginBottom: 18 }}>
          <div className="section-label">Daily cron &amp; models</div>
          <div
            className="rounded-[var(--radius)] border p-[var(--card-pad)]"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 10 }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <PipelineEnabledToggle enabled={prefs.enabled} />
              <span className="text-xs" style={{ color: 'var(--dim)' }}>
                Runs weekdays after the External Scan on the shared cron (Monday covers the weekend) ·
                {' '}discovery: {tavily ? 'Tavily (LLM-free, rotating queries daily)' : 'claude-sonnet-4-6 + web_search'} ·
                {' '}triage/sweep/coverage: {openrouter ? 'utility model via OpenRouter' : 'claude-sonnet-4-6'}
              </span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Analysis model{prefs.analysis_models.length > 1 ? 's' : ''} · drafts stamp their model; the
                Model A/B table below compares them{openrouter ? '' : '. OPENROUTER_API_KEY is unset, so non-Claude picks will error until it is added'}
              </div>
              <EnrichModelPicker
                selected={prefs.analysis_models}
                saveAction={setPipelineAnalysisModelsAction}
                fallbackNote="None selected: analysis stays on Claude Sonnet."
              />
            </div>
            {modelStats.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>model</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>drafts</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>published</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>archived</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg touches</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg ms</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>$/draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelStats.map((s) => (
                      <tr key={s.model} style={{ color: 'var(--dim)' }}>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                          {modelLabel.get(s.model) ?? s.model}
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.drafts}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.published}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.archived}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.avgTouches ?? '–'}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.avgWallMs ?? '–'}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{s.costPerDraft === null ? '–' : `$${s.costPerDraft.toFixed(4)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

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

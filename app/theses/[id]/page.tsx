import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import {
  getTargets, getThesis, getThesisReportsMeta, getThesisTreeData,
  resolvePeriodTouches, reconcileArgumentGapScan,
} from '@/lib/data';
import {
  diagnoseThesisGapsAction, dismissThesisGapAction, clearThesisGapScanAction,
} from '@/lib/actions';
import Header from '@/components/Header';
import ArgumentGapPanel from '@/components/ArgumentGapPanel';
import ThesisLogicTree, { type ThesisTreeGhost } from '@/components/ThesisLogicTree';
import ThesisConsole from '@/components/ThesisConsole';
import ThesisForm from '@/components/ThesisForm';

export const dynamic = 'force-dynamic';
// Hosts the pack build + the two narrative-generation server actions.
export const maxDuration = 60;
export const metadata = { title: 'Thesis · The AI Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function ThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await isAdmin();
  if (!admin) redirect('/login');
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const thesis = await getThesis(id);
  if (!thesis) notFound();
  const [reports, targets, touches, treeNodes] = await Promise.all([
    getThesisReportsMeta(id),
    getTargets(),
    resolvePeriodTouches(new Map(thesis.claim_codes.map((c) => [c, 0])), true),
    getThesisTreeData(thesis.claim_codes),
  ]);

  // The per-thesis gap scan (migration 0036), reconciled so a recommendation whose
  // code has since become a live claim/bridge never resurfaces.
  const gapScan = reconcileArgumentGapScan(
    thesis.gap_scan ?? null,
    new Set([...targets.claims, ...targets.bridges].map((t) => t.code))
  );

  // Gap recommendations render as dashed ghost nodes on the logic tree, each
  // linking its Start-draft form (the &thesis param maps the created code back).
  const ghosts: ThesisTreeGhost[] = (gapScan?.recommendations ?? []).map((r) => ({
    code: r.code,
    kind: r.kind,
    statement: r.statement,
    href: r.kind === 'bridge'
      ? `/bridge/new?gap=${encodeURIComponent(r.code)}&thesis=${thesis.id}`
      : `/q/${r.question_slug}/claim/new?gap=${encodeURIComponent(r.code)}&thesis=${thesis.id}`,
  }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <header className="pagehead">
          <p style={{ margin: '0 0 6px', fontSize: 12 }}>
            <Link href="/theses" style={{ color: 'var(--faint-ink)' }}>← Theses</Link>
          </p>
          <h1 style={{ fontSize: 'clamp(20px,3.2vw,28px)' }}>{thesis.statement}</h1>
          {thesis.mapping_note && <p className="lede">{thesis.mapping_note}</p>}
        </header>

        {/* 1 · The thesis: the statement above; editing it (and its mapping) is
            the step-1 affordance. Opens automatically while the thesis is
            unmapped, so a fresh draft from /map lands with the mapping form
            (and its "Map to Atlas claims" button) in view. */}
        <details style={{ marginBottom: 22 }} open={thesis.claim_codes.length === 0}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--faint-ink)' }}>
            1 · Edit the thesis (statement and mapping)
          </summary>
          <div style={{ marginTop: 12 }}>
            <ThesisForm
              targets={targets}
              thesis={{
                id: thesis.id,
                statement: thesis.statement,
                claim_codes: thesis.claim_codes,
                mapping_note: thesis.mapping_note,
              }}
            />
          </div>
        </details>

        {/* 2 · The mapping, drawn as the logic tree the thesis stands on. */}
        <section style={{ marginBottom: 22 }}>
          <div className="section-label">2 · The mapping · the logic tree</div>
          <ThesisLogicTree statement={thesis.statement} nodes={treeNodes} ghosts={ghosts} />
          {touches.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--faint-ink)' }}>
                Mapped claims as a list ({touches.length})
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--dim)', fontSize: 14, lineHeight: 1.6 }}>
                {touches.map((t) => (
                  <li key={t.code} style={{ margin: '3px 0' }}>
                    <Link href={t.href} style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{t.code}</Link>
                    {' · '}<span style={{ color: 'var(--ink)' }}>{t.statement}</span>
                    {t.unresolved && <span style={{ color: 'var(--heat-4)' }}> · no longer resolves</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* 3 · What claims does THIS thesis depend on that the map lacks. Start
            draft pre-fills the authoring form and the submit maps the new code
            back onto the thesis. */}
        <div style={{ marginBottom: 22 }}>
          <ArgumentGapPanel
            initial={gapScan}
            diagnose={diagnoseThesisGapsAction.bind(null, thesis.id)}
            dismiss={dismissThesisGapAction.bind(null, thesis.id)}
            clear={clearThesisGapScanAction.bind(null, thesis.id)}
            thesisId={thesis.id}
            title="3 · Gap diagnosis"
            explainer="The model reads this thesis, its mapped claims, and the signals its text attracts, and argues for the few claims the thesis depends on that the map lacks. Proposals appear as dashed nodes on the tree above. Creating a claim from one also maps it onto this thesis."
            emptyCopy="No gaps. The mapped claims already cover the legs this thesis stands on."
          />
        </div>

        {/* 4 · The frozen, cited artifact: pack, narrative, saved runs. */}
        <div className="section-label">4 · Reports</div>
        <ThesisConsole
          thesis={{ id: thesis.id, statement: thesis.statement, status: thesis.status }}
          initialReports={reports}
        />
      </section>
    </>
  );
}

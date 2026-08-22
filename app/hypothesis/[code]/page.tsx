import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPreview } from '@/lib/auth';
import { getHypothesis } from '@/lib/data';
import {
  diagnoseHypothesisGapsAction, dismissHypothesisGapAction, clearHypothesisGapScanAction,
} from '@/lib/actions';
import {
  RESOLVABILITY_LABEL, convictionText, heatVar, dateLabel, timeAgo,
} from '@/lib/format';
import Header from '@/components/Header';
import HeatChips from '@/components/HeatChips';
import ConvictionEditor from '@/components/ConvictionEditor';
import EvidenceList from '@/components/EvidenceList';
import HypothesisForm from '@/components/HypothesisForm';
import HypothesisLinks from '@/components/HypothesisLinks';
import HypothesisConsole from '@/components/HypothesisConsole';
import ArgumentGapPanel from '@/components/ArgumentGapPanel';
import SignalCard from '@/components/SignalCard';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';
// Hosts AI server actions (gap diagnosis + the report console's model legs).
export const maxDuration = 60;

// One hypothesis: the statement + test, the gated conviction (admin moves it,
// rationale required), the evidence links, the signals touching it, the linked
// hypotheses, the per-hypothesis gap scan, and the report console.
export default async function HypothesisPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  const view = await getHypothesis(decodeURIComponent(code), personal);
  if (!view) notFound();
  const { hypothesis: h, evidence, counts, rationales, links, signals, reports } = view;

  const oneSided = counts.oneSided;
  const evidenceOptions = evidence.map((ev) => ({
    id: ev.id,
    label: `${ev.direction} · ${(ev.excerpt || ev.source_title || ev.signal_title || 'evidence').slice(0, 80)}`,
  }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 880, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Hypotheses</Link> / {h.code}
        </div>

        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', fontSize: 13 }}>{h.code}</span>
            {h.status !== 'active' && (
              <span className="badge badge--dashed" style={{ fontSize: 11, padding: '3px 9px' }}>{h.status}</span>
            )}
            {h.resolvability && (
              <span className="badge" style={{ fontSize: 11, padding: '3px 9px' }}>
                {RESOLVABILITY_LABEL[h.resolvability]} to resolve
              </span>
            )}
            {personal && h.conviction != null && (
              <span className="flex items-center gap-2">
                <HeatChips conviction={h.conviction} label={h.conviction_label} />
                <span style={{ color: heatVar(h.conviction_label), fontSize: 13, fontWeight: 600 }}>
                  {h.conviction.toFixed(2)} · {convictionText(h.conviction_label)}
                </span>
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 30px)', lineHeight: 1.25 }}>{h.statement}</h1>
          <p className="lede" style={{ fontSize: 14, marginTop: 10 }}>
            <span style={{ color: 'var(--faint-ink)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
              would falsify ·{' '}
            </span>
            {h.test}
          </p>
          {personal && h.note && (
            <p style={{ fontSize: 13, color: 'var(--faint-ink)', marginTop: 8 }}>{h.note}</p>
          )}
        </header>

        {!personal && <ShareNotice asOf={null} />}

        {/* The human gate: conviction moves only with a rationale. */}
        {personal && (
          <section style={{ marginBottom: 26 }}>
            <ConvictionEditor
              hypothesisId={h.id}
              current={h.conviction}
              redirectTo={`/hypothesis/${encodeURIComponent(h.code)}`}
              evidenceOptions={evidenceOptions}
            />
          </section>
        )}

        {/* Evidence */}
        <section style={{ marginBottom: 26 }}>
          <div className="section-label">
            Evidence · {evidence.length}
            <span style={{ marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint-ink)' }}>
              {counts.supports} support · {counts.contradicts} contradict · {counts.neutral} neutral
            </span>
          </div>
          {oneSided && (
            <p style={{ color: 'var(--heat-3)', fontSize: 13, margin: '6px 0 10px' }}>
              One-sided: every attached item supports this hypothesis. Look for the strongest contradicting evidence.
            </p>
          )}
          <EvidenceList evidence={evidence} admin={personal} />
          {personal && (
            <p style={{ fontSize: 12.5, color: 'var(--faint-ink)', marginTop: 8 }}>
              Attach evidence from a source page (<Link href="/sources" style={{ color: 'var(--accent)' }}>the library</Link>),
              or publish a signal that touches {h.code}.
            </p>
          )}
        </section>

        {/* Signals touching this hypothesis */}
        <section style={{ marginBottom: 26 }}>
          <div className="section-label">Signals touching {h.code} · {signals.length}</div>
          {signals.length === 0 ? (
            <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No published signal touches this hypothesis yet.</p>
          ) : (
            <div className="signal-feed">
              {signals.slice(0, 8).map((s) => (
                <SignalCard key={s.id} signal={s} admin={personal} redirectTo={`/hypothesis/${encodeURIComponent(h.code)}`} />
              ))}
            </div>
          )}
        </section>

        {/* Related hypotheses */}
        <section style={{ marginBottom: 26 }}>
          <div className="section-label">Related hypotheses</div>
          <HypothesisLinks hypothesisId={h.id} links={links} admin={personal} />
        </section>

        {/* Conviction history (admin) */}
        {personal && rationales.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <div className="section-label">Conviction history · {rationales.length}</div>
            <div className="flex flex-col gap-3">
              {rationales.map((r) => (
                <div key={r.id} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 12 }}>
                  <div className="flex items-center gap-2 flex-wrap text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
                    <span>{r.old_conviction?.toFixed(2) ?? '–'} → {r.new_conviction?.toFixed(2) ?? '–'}</span>
                    <span style={{ color: 'var(--faint-ink)' }}>· {dateLabel(r.created_at) ?? timeAgo(r.created_at)}</span>
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: '3px 0 0', lineHeight: 1.5 }}>{r.reason}</p>
                  {r.evidence_excerpt && (
                    <p style={{ fontSize: 12, color: 'var(--faint-ink)', margin: '2px 0 0', fontStyle: 'italic' }}>
                      cited: {r.evidence_excerpt.slice(0, 160)}
                      {r.evidence_source ? ` (${r.evidence_source})` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Per-hypothesis gap scan (admin) */}
        {personal && (
          <section style={{ marginBottom: 26 }}>
            <ArgumentGapPanel
              initial={h.gap_scan ?? null}
              diagnose={diagnoseHypothesisGapsAction.bind(null, h.id)}
              dismiss={dismissHypothesisGapAction.bind(null, h.id)}
              clear={clearHypothesisGapScanAction.bind(null, h.id)}
              hypothesisId={h.id}
              title="Hypothesis gap scan"
              explainer="The model reads the signals that match this hypothesis by text but are not linked as evidence, and argues for narrower or adjacent hypotheses they demand. Creating one links it back here."
              emptyCopy="No gaps: the matched signals are accounted for."
            />
          </section>
        )}

        {/* Reports console (admin) / public report list */}
        {personal ? (
          <section style={{ marginBottom: 26 }}>
            <div className="section-label">Reports</div>
            <HypothesisConsole
              hypothesis={{ id: h.id, statement: h.statement, status: h.status }}
              initialReports={reports}
            />
          </section>
        ) : reports.length > 0 ? (
          <section style={{ marginBottom: 26 }}>
            <div className="section-label">Reports</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.7 }}>
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/hypothesis-report/${r.id}`} style={{ color: 'var(--accent)' }}>{r.title}</Link>
                  {' · '}{dateLabel(r.generated_at) ?? r.generated_at.slice(0, 10)} · {r.matched} signals
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Edit (admin) */}
        {personal && (
          <section>
            <div className="section-label">Edit</div>
            <HypothesisForm hypothesis={h} />
          </section>
        )}
      </section>
    </>
  );
}

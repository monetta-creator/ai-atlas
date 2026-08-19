import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getBridge, getAsOf, getSignalsTouchingClaim, getPapersForTarget, getThesesForTarget } from '@/lib/data';
import { DOMAIN_LABEL, RESOLVABILITY_LABEL, relationColor, dateLabel, directionLabel } from '@/lib/format';
import Header from '@/components/Header';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import ConfidenceEditor from '@/components/ConfidenceEditor';
import EvidenceList from '@/components/EvidenceList';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';

export default async function BridgePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const [data, asOf, relatedSignals, relatedPapers, trackingTheses] = await Promise.all([
    getBridge(decodeURIComponent(code), personal),
    getAsOf(),
    getSignalsTouchingClaim(decodeURIComponent(code), personal),
    getPapersForTarget(decodeURIComponent(code)),
    getThesesForTarget(decodeURIComponent(code)),
  ]);
  if (!data) notFound();
  const { bridge, fedBy, evidence, counts, rationales } = data;
  const evidenceOptions = evidence.map((ev) => ({
    id: ev.id,
    label: `${directionLabel(ev.direction)} · ${ev.source_title ?? ev.signal_title ?? 'evidence'}${
      ev.excerpt ? ` · ${ev.excerpt.slice(0, 60)}` : ''
    }`,
  }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/bridges">Bridges</Link> / {bridge.code}
        </div>

        {!personal && <ShareNotice asOf={asOf} />}

        <div className="bridge" style={{ marginTop: 8 }}>
          <div className="flex items-start justify-between gap-3">
            <div className="btag">⤧ bridge-claim · {bridge.code}</div>
            {personal && <ConfidenceBadge label={bridge.confidence_label} size="md" />}
          </div>
          <div className="domains">
            <span className="domain">{DOMAIN_LABEL[bridge.domain_from]}</span>
            <span className="arrow">
              <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M1 7h22M18 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="domain">{DOMAIN_LABEL[bridge.domain_to]}</span>
            {bridge.resolvability && (
              <span className="domain">{RESOLVABILITY_LABEL[bridge.resolvability]} to resolve</span>
            )}
            {bridge.reflexive && <span className="domain" style={{ color: 'var(--accent)' }}>⟳ reflexive</span>}
          </div>
          <h3>{bridge.statement}</h3>
          <div className="test">
            <span className="tlabel">would falsify</span>
            <span>{bridge.test}</span>
          </div>
          {bridge.note && (
            <div className="exposed">{bridge.note}</div>
          )}
        </div>

        {personal && (
          <p style={{ margin: '10px 0 0' }}>
            <Link href={`/reports?generate=claim&code=${bridge.code}`} className="btn btn--ghost btn--sm">
              Generate tear sheet →
            </Link>
          </p>
        )}

        {personal && (
          <section>
            <div className="section-label">Confidence</div>
            <ConfidenceEditor
              targetType="bridge_claim"
              targetId={bridge.id}
              current={bridge.confidence}
              redirectTo={`/bridge/${bridge.code}`}
              evidenceOptions={evidenceOptions}
            />
          </section>
        )}

        <section>
          <div className="section-label">Fed by claims (in either domain)</div>
          <div className="rel-list">
            {fedBy.map((f, i) => (
              <Link key={i} href={`/claim/${encodeURIComponent(f.claim_code)}`} className="rel-item">
                <span className={`rel-kind ${relationColor(f.relation as never)}`}>{f.relation}</span>
                <span style={{ color: 'var(--dim)' }}>
                  <span style={{ color: 'var(--faint-ink)' }}>{f.claim_code}</span> {f.claim_statement}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between" style={{ margin: '44px 0 18px' }}>
            <span className="lbl">Evidence</span>
            <div className="flex items-center gap-3 text-xs">
              <span style={{ color: 'var(--supports)' }}>{counts.supports} support</span>
              <span style={{ color: 'var(--contradicts)' }}>{counts.contradicts} contradict</span>
            </div>
          </div>
          {counts.oneSided && (
            <div
              className="rounded-[var(--radius)] px-3.5 py-2.5 mb-3 text-xs border"
              style={{ borderColor: 'var(--heat-4)', color: 'var(--heat-4)' }}
            >
              ⚠ One-sided. All evidence points the same way.
            </div>
          )}
          <EvidenceList evidence={evidence} admin={personal} />
        </section>

        {relatedSignals.length > 0 && (
          <section>
            <div className="section-label">Signals on the board</div>
            <div className="rel-list">
              {relatedSignals.map((s) => (
                <Link key={s.id} href={`/signals/${s.id}`} className="rel-item">
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>
                    {dateLabel(s.published_at) ?? '–'}
                  </span>
                  <span style={{ color: 'var(--dim)' }}>{s.title}</span>
                  {personal && !s.is_published && (
                    <span className="badge badge--dashed" style={{ fontSize: 10, marginLeft: 6 }}>draft</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* reviewed research whose ADVISORY touches name this bridge; papers never write evidence */}
        {relatedPapers.length > 0 && (
          <section>
            <div className="section-label">Research bearing on this · advisory</div>
            <div className="rel-list">
              {relatedPapers.map((p) => (
                <Link key={p.id} href={`/research/${p.id}`} className="rel-item" title={p.headline ?? undefined}>
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>{p.published_at ?? '–'}</span>
                  <span style={{ color: 'var(--dim)' }}>{p.title}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* standing theses whose confirmed mapping includes this bridge. Guests
            link the latest public report; only admins link the workflow page. */}
        {trackingTheses.length > 0 && (
          <section>
            <div className="section-label">Theses tracking this claim</div>
            <div className="rel-list">
              {trackingTheses.map((t) => {
                const href = personal
                  ? `/theses/${t.id}`
                  : t.latest_report_id
                    ? `/thesis-report/${t.latest_report_id}`
                    : null;
                const body = (
                  <>
                    <span className="rel-kind">thesis</span>
                    <span style={{ color: 'var(--dim)' }}>{t.statement}</span>
                  </>
                );
                return href ? (
                  <Link key={t.id} href={href} className="rel-item">{body}</Link>
                ) : (
                  <span key={t.id} className="rel-item">{body}</span>
                );
              })}
            </div>
          </section>
        )}

        {personal && (
          <section>
            <div className="section-label">Rationale history</div>
            {rationales.length === 0 ? (
              <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No confidence moves yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {rationales.map((r) => (
                  <div key={r.id} className="rationale">
                    <span className="delta">
                      {r.old_confidence ?? '–'} → {r.new_confidence ?? '–'}
                    </span>
                    <p>{r.reason}</p>
                    {r.evidence_id && (r.evidence_source || r.evidence_excerpt) && (
                      <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 4 }}>
                        cites {r.evidence_direction ?? ''} evidence
                        {r.evidence_source ? ` · ${r.evidence_source}` : ''}
                        {r.evidence_excerpt ? ` · ${r.evidence_excerpt}` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </section>
    </>
  );
}

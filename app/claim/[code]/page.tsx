import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getClaim, getAsOf, getSignalsTouchingClaim, getPapersForTarget, getThesesForTarget } from '@/lib/data';
import { DOMAIN_LABEL, RESOLVABILITY_LABEL, LENS_LABEL, relationColor, dateLabel, directionLabel } from '@/lib/format';
import Header from '@/components/Header';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import ConfidenceEditor from '@/components/ConfidenceEditor';
import EvidenceList from '@/components/EvidenceList';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  // One round trip's worth of independent reads (the touching-signals lookup
  // keys on the code we already hold; a frame just discards it below).
  const [data, asOf, touching, touchingPapers, trackingTheses] = await Promise.all([
    getClaim(decodeURIComponent(code), personal),
    getAsOf(),
    getSignalsTouchingClaim(decodeURIComponent(code), personal),
    getPapersForTarget(decodeURIComponent(code)),
    getThesesForTarget(decodeURIComponent(code)),
  ]);
  if (!data) notFound();
  const { claim, lenses, toStances, toBridges, frames, organizes, evidence, counts, rationales } = data;
  // Signal Board entries that name this claim (admin also sees drafts not yet published).
  const relatedSignals = claim.is_frame ? [] : touching;
  // Reviewed research whose advisory touches name this claim (never evidence).
  const relatedPapers = claim.is_frame ? [] : touchingPapers;
  // Evidence the author can cite when moving this claim's confidence (admin only).
  const evidenceOptions = evidence.map((ev) => ({
    id: ev.id,
    label: `${directionLabel(ev.direction)} · ${ev.source_title ?? ev.signal_title ?? 'evidence'}${
      ev.excerpt ? ` · ${ev.excerpt.slice(0, 60)}` : ''
    }`,
  }));

  // ---- frame view (organizing belief; quarantined from evidence) ----
  if (claim.is_frame) {
    return (
      <>
        <Header admin={admin} />
        <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
          <div className="crumbs">
            <Link href="/map">Map</Link> / Frame {claim.code}
          </div>
          <header className="qhead">
            <div className="qcode">
              <span className="badge badge--accent">◆ Frame · {claim.code}</span>
            </div>
            <h1>{claim.statement}</h1>
            <p className="lede">
              A frame is an organizing belief that shapes which claims are looked for, but isn&apos;t
              itself cleanly falsifiable. It is stored and labeled, and{' '}
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>
                quarantined from confirming-evidence accumulation
              </span>
              . It records what it organizes; it accumulates no evidence.
            </p>
          </header>

          {!personal && <ShareNotice asOf={asOf} />}

          {organizes.length > 0 && (
            <section>
              <div className="section-label">Organizes these claims</div>
              <div className="rel-list">
                {organizes.map((c) => (
                  <Link
                    key={c.code}
                    href={`/claim/${encodeURIComponent(c.code)}`}
                    className="rel-item"
                    style={{ color: 'var(--dim)' }}
                  >
                    <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>{c.code}</span>
                    {c.statement}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Claim {claim.code}
        </div>

        <header className="qhead">
          <div className="qcode" style={{ justifyContent: 'space-between' }}>
            <span>Claim {claim.code}</span>
            {personal && <ConfidenceBadge label={claim.confidence_label} size="md" />}
          </div>
          <h1>{claim.statement}</h1>
          <div className="flex items-center flex-wrap gap-2 mt-4">
            {claim.domain && <span className="badge">{DOMAIN_LABEL[claim.domain]}</span>}
            {claim.resolvability && (
              <span className="badge">{RESOLVABILITY_LABEL[claim.resolvability]} to resolve</span>
            )}
            {claim.reflexive && <span className="badge badge--accent">⟳ reflexive</span>}
            {lenses.map((l) => (
              <span key={l} className="badge">{LENS_LABEL[l]}</span>
            ))}
          </div>
        </header>

        {!personal && <ShareNotice asOf={asOf} />}

        {/* the test — prominent */}
        {claim.test && (
          <div className="test-panel" style={{ marginBottom: 8 }}>
            <span className="tlabel">would falsify this claim</span>
            <p>{claim.test}</p>
          </div>
        )}

        {personal && (
          <p style={{ margin: '4px 0 8px' }}>
            <Link
              href={`/reports?generate=claim&code=${encodeURIComponent(claim.code)}`}
              className="btn btn--ghost btn--sm"
            >
              Generate tear sheet →
            </Link>
          </p>
        )}

        {claim.domain_note && personal && (
          <p className="text-[11px] mt-4" style={{ color: 'var(--faint-ink)' }}>
            Seed domain tag: <span className="italic">{claim.domain_note}</span>
          </p>
        )}

        {personal && (
          <section>
            <div className="section-label">Confidence</div>
            <ConfidenceEditor
              targetType="claim"
              targetId={claim.id}
              current={claim.confidence}
              redirectTo={`/claim/${encodeURIComponent(claim.code)}`}
              evidenceOptions={evidenceOptions}
            />
          </section>
        )}

        {/* evidence */}
        <section>
          <div className="flex items-center justify-between" style={{ margin: '44px 0 18px' }}>
            <span className="lbl">Evidence</span>
            <div className="flex items-center gap-3 text-xs">
              <span style={{ color: 'var(--supports)' }}>{counts.supports} support</span>
              <span style={{ color: 'var(--contradicts)' }}>{counts.contradicts} contradict</span>
              {counts.neutral > 0 && (
                <span style={{ color: 'var(--heat-against)' }}>{counts.neutral} neutral</span>
              )}
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

        {/* signals on the board that touch this claim (a cross-link, distinct from evidence) */}
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

        {/* reviewed research whose ADVISORY touches name this claim; papers never write evidence */}
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

        {/* standing theses whose confirmed mapping includes this claim. Statements
            are public (the tracker/reports already show them); guests link the
            latest public report, only admins link the workflow page. */}
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

        {/* relationships */}
        {(toStances.length > 0 || toBridges.length > 0) && (
          <section>
            <div className="section-label">Bears on</div>
            <div className="rel-list">
              {toStances.map((s, i) => (
                <Link key={`s${i}`} href={`/q/${s.q_slug}`} className="rel-item">
                  <span className={`rel-kind ${relationColor(s.relation as never)}`}>{s.relation}</span>
                  <span style={{ color: 'var(--dim)' }}>
                    <span style={{ color: 'var(--faint-ink)' }}>{s.stance_code}</span> {s.stance_title}
                  </span>
                </Link>
              ))}
              {toBridges.map((b, i) => (
                <Link key={`b${i}`} href={`/bridge/${b.bridge_code}`} className="rel-item">
                  <span className={`rel-kind ${relationColor(b.relation as never)}`}>{b.relation}</span>
                  <span style={{ color: 'var(--accent)' }}>
                    {b.bridge_code} · {b.bridge_statement}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {frames.length > 0 && (
          <section>
            <div className="section-label">Organized by frame</div>
            <div className="rel-list">
              {frames.map((f) => (
                <Link key={f.code} href={`/claim/${f.code}`} className="rel-item" style={{ color: 'var(--accent)' }}>
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>◆ {f.code}</span>
                  {f.statement}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* rationale history (admin only) */}
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

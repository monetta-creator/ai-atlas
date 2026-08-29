import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPreview } from '@/lib/auth';
import { getSignal, getSource, getRelatedSignals } from '@/lib/data';
import { getAskClientData } from '@/lib/ask/retrieve';
import { dateLabel, DOMAIN_LABEL, confidenceText, directionLabel, directionColor } from '@/lib/format';
import { publishSignalAction, deleteSignalAction, archiveSignalAction, unarchiveSignalAction } from '@/lib/actions';
import Header from '@/components/Header';
import { LensBadges, SignificanceTag } from '@/components/SignalBadges';
import RelatedSignalsTable from '@/components/RelatedSignalsTable';
import { SignalBriefSection, SignalCounterpointSection } from '@/components/SignalBriefView';
import GenerateSignalAnalysisButton from '@/components/GenerateSignalAnalysisButton';
import GenerateDossierButton from '@/components/GenerateDossierButton';
import DossierView from '@/components/DossierView';
import AskAtlas from '@/components/AskAtlas';

export const dynamic = 'force-dynamic';
// The page hosts AI server actions (Generate analysis, Generate dossier).
export const maxDuration = 60;

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  const [data, validIds] = await Promise.all([
    getSignal(id, personal),
    personal ? getAskClientData() : Promise.resolve(null),
  ]);
  if (!data) notFound();
  const { signal, touches } = data;

  // The proxy lets guests reach /signals/<id>; a draft must still 404 for them.
  if (!signal.is_published && !personal) notFound();

  // The dependent second wave: related signals need the touches, the source
  // dossier needs the source id. Both admin-relevant reads run concurrently.
  const [related, srcData] = await Promise.all([
    getRelatedSignals(signal.id, signal.claim_touches, personal),
    personal && signal.source_id ? getSource(signal.source_id) : Promise.resolve(null),
  ]);
  const dossier = srcData?.source.dossier ?? null;

  const date = dateLabel(signal.published_at);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/signals">Signal Board</Link> / {signal.title}
        </div>

        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <div className="signal-top" style={{ marginBottom: 12 }}>
            <LensBadges lenses={signal.lenses} />
            <SignificanceTag significance={signal.significance} />
            {personal && !signal.is_published && (
              <span className="badge badge--dashed" style={{ fontSize: 11, padding: '3px 9px' }}>
                {signal.archived_at ? 'Archived' : 'Draft'}
              </span>
            )}
            {personal && signal.origin === 'pipeline' && (
              <span className="badge badge--accent" style={{ fontSize: 11, padding: '3px 9px' }}>pipeline</span>
            )}
            {personal && signal.origin === 'manual' && (
              <span className="badge" style={{ fontSize: 11, padding: '3px 9px' }}>manual</span>
            )}
            {personal && signal.drafted_by && (
              <span
                className="badge"
                style={{ fontSize: 11, padding: '3px 9px', fontFamily: 'var(--font-mono)' }}
                title="Model that drafted this signal (the analysis A/B stamp)"
              >
                {signal.drafted_by}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}>{signal.title}</h1>
          <p className="lede" style={{ fontSize: 14, marginTop: 8 }}>
            {date}
            {signal.source_title && (
              <>
                {' · '}
                {signal.source_url ? (
                  <a
                    href={signal.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    {signal.source_title}
                  </a>
                ) : (
                  signal.source_title
                )}
              </>
            )}
          </p>
        </header>

        {signal.summary && (
          <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--ink)', margin: '0 0 12px' }}>
            {signal.summary}
          </p>
        )}

        {/* Admin analyst tools, sat at the top right under the summary: generate the cached
            analysis, profile the source, and ask the signal. */}
        {personal && (
          <section style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div className="section-label">Analyst tools</div>

            <div className="flex items-center flex-wrap gap-3" style={{ marginTop: 12 }}>
              <GenerateSignalAnalysisButton
                signalId={signal.id}
                hasAnalysis={Boolean(signal.brief || signal.counterpoint)}
              />
              {signal.source_id && (
                <GenerateDossierButton
                  sourceId={signal.source_id}
                  hasDossier={Boolean(dossier)}
                  redirectTo={`/signals/${signal.id}`}
                />
              )}
            </div>

            {validIds && (
              <div style={{ marginTop: 22 }}>
                <div className="section-label">Ask this signal</div>
                <p style={{ color: 'var(--faint-ink)', fontSize: 13, margin: '6px 0 0' }}>
                  Answers are grounded only in this signal, its source, and the claims it touches.
                </p>
                <AskAtlas
                  validIds={validIds}
                  endpoint={`/api/signals/${signal.id}/ask`}
                  placeholder="Ask about this development, for example: what is the strongest evidence here, and what is left unresolved?"
                />
              </div>
            )}

            {dossier && (
              <div style={{ marginTop: 22 }}>
                <div className="section-label">Source dossier</div>
                <DossierView dossier={dossier} />
              </div>
            )}
          </section>
        )}

        {/* Cached AI deep-dive: expands the one-paragraph summary. Public (admin generates). */}
        {signal.brief && <SignalBriefSection brief={signal.brief} />}

        {/* The other read: the opposing interpretation + what would deflate it. Public. */}
        {signal.counterpoint && <SignalCounterpointSection counterpoint={signal.counterpoint} />}

        {/* Claims and bridge-claims this signal links to. */}
        <section style={{ marginTop: 30 }}>
          <div className="section-label">On the Argument Map</div>
          {touches.length === 0 ? (
            <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
              Not yet linked to any claim or bridge-claim.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {touches.map((t) => {
                // A code that no longer resolves (admin-only) — flag it, don't link it.
                if (t.unresolved) {
                  return (
                    <div key={t.code} className="touch-detail" style={{ opacity: 0.7 }}>
                      <div className="td-head">
                        <span>{t.code}</span>
                        <span style={{ color: 'var(--heat-4)' }}>· unresolved code</span>
                      </div>
                      <div className="td-stmt">{t.statement}</div>
                    </div>
                  );
                }
                return (
                  <Link key={t.code} href={t.href} className="touch-detail">
                    <div className="td-head">
                      <span>{t.code}</span>
                      <span>· {t.type === 'bridge_claim' ? 'bridge-claim' : 'claim'}</span>
                      {/* direction is descriptive (how it bears on the claim) — public */}
                      {t.direction && (
                        <span className={directionColor(t.direction)}>· {directionLabel(t.direction)}</span>
                      )}
                      {t.domain && <span>· {DOMAIN_LABEL[t.domain]}</span>}
                      {/* confidence is the personal layer — admin only */}
                      {personal && t.confidence_label && <span>· {confidenceText(t.confidence_label)}</span>}
                    </div>
                    <div className="td-stmt">{t.statement}</div>
                    {/* the model's reason is admin-only (personal layer) */}
                    {personal && t.reason && (
                      <div className="td-stmt" style={{ color: 'var(--faint-ink)', fontSize: 13, marginTop: 2 }}>
                        {t.reason}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* In context: other tracked signals on the same claims, as a compact table. Public. */}
        {related.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <div className="section-label">In context</div>
            <p style={{ color: 'var(--faint-ink)', fontSize: 13, margin: '0 0 12px' }}>
              {related.length} other tracked development{related.length === 1 ? '' : 's'} touching the same claims.
            </p>
            <RelatedSignalsTable signals={related} />
          </section>
        )}

        {/* Admin controls */}
        {personal && (
          <section style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
            <div className="signal-admin-row" style={{ border: 'none', padding: 0, marginTop: 0 }}>
              <form action={publishSignalAction}>
                <input type="hidden" name="id" value={signal.id} />
                <input type="hidden" name="publish" value={signal.is_published ? '0' : '1'} />
                <input type="hidden" name="redirect_to" value={`/signals/${signal.id}`} />
                <button type="submit" className="btn btn--ghost btn--sm">
                  {signal.is_published ? 'Unpublish' : 'Publish'}
                </button>
              </form>
              <Link href={`/signals/${signal.id}/edit`} className="btn btn--ghost btn--sm">Edit</Link>
              {!signal.is_published && (
                <form action={signal.archived_at ? unarchiveSignalAction : archiveSignalAction}>
                  <input type="hidden" name="id" value={signal.id} />
                  <input type="hidden" name="redirect_to" value={`/signals/${signal.id}`} />
                  <button type="submit" className="btn btn--ghost btn--sm">
                    {signal.archived_at ? 'Unarchive' : 'Archive'}
                  </button>
                </form>
              )}
              <form action={deleteSignalAction}>
                <input type="hidden" name="id" value={signal.id} />
                <button type="submit" className="btn btn--quiet btn--sm" style={{ color: 'var(--heat-4)' }}>
                  Delete
                </button>
              </form>
            </div>
          </section>
        )}
      </section>
    </>
  );
}

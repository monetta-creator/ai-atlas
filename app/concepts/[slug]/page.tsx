import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getConcept, getAsOf, getPapersForConcept } from '@/lib/data';
import { CONCEPT_STATUS_LABEL } from '@/lib/format';
import Header from '@/components/Header';
import ConvictionBadge from '@/components/ConvictionBadge';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';

export default async function ConceptPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const data = await getConcept(decodeURIComponent(slug), personal);
  if (!data) notFound();
  const { concept, prerequisites, dependents, hypotheses } = data;
  const asOf = await getAsOf();
  // Recent research is part of the admin-first research surface (/research is gated),
  // so the pane renders for the admin only until that surface goes public.
  const papers = personal ? await getPapersForConcept(concept.slug) : [];

  const paragraphs = (concept.explanation ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/concepts">Concepts</Link> / {concept.name}
        </div>

        <header className="qhead">
          <div className="qcode" style={{ justifyContent: 'space-between' }}>
            <span>Concept · {concept.slug}</span>
            {personal && (
              <Link href={`/concepts/${concept.slug}/edit`} className="btn btn--ghost btn--sm">
                Edit
              </Link>
            )}
          </div>
          <h1>{concept.name}</h1>
          <p className="lede">{concept.short_definition}</p>
        </header>

        {!personal && <ShareNotice asOf={asOf} />}

        {/* the settled/contested marker — the distinction the scaffold exists to surface */}
        <div className="concept-status-panel" data-status={concept.status} style={{ marginTop: 18 }}>
          <span className="clabel">{CONCEPT_STATUS_LABEL[concept.status]}</span>
          <p>
            {concept.status === 'contested'
              ? 'The definition itself is disputed: what this term refers to depends on who is using it. Read any argument that leans on it twice.'
              : 'Broad technical consensus on what this term means. Disagreements that invoke it are about the world, not the word.'}
          </p>
        </div>

        {paragraphs.length > 0 && (
          <section>
            <div className="section-label">What it is</div>
            <div className="flex flex-col gap-3">
              {paragraphs.map((p, i) => (
                <p key={i} style={{ color: 'var(--dim)', fontSize: 15.5, lineHeight: 1.7, margin: 0 }}>
                  {p}
                </p>
              ))}
            </div>
          </section>
        )}

        {prerequisites.length > 0 && (
          <section>
            <div className="section-label">Understand first</div>
            <div className="rel-list">
              {prerequisites.map((c) => (
                <Link key={c.id} href={`/concepts/${c.slug}`} className="rel-item">
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>{c.slug}</span>
                  <span style={{ color: 'var(--dim)' }}>
                    {c.name} · {c.short_definition}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {dependents.length > 0 && (
          <section>
            <div className="section-label">Builds toward</div>
            <div className="rel-list">
              {dependents.map((c) => (
                <Link key={c.id} href={`/concepts/${c.slug}`} className="rel-item">
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>{c.slug}</span>
                  <span style={{ color: 'var(--dim)' }}>
                    {c.name} · {c.short_definition}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {hypotheses.length > 0 && (
          <section>
            <div className="section-label">On the Atlas</div>
            <div className="rel-list">
              {hypotheses.map((c) => (
                <Link key={c.code} href={c.href} className="rel-item">
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>{c.code}</span>
                  <span style={{ color: 'var(--dim)' }}>{c.statement}</span>
                  {personal && c.unresolved && (
                    <span className="badge badge--dashed" style={{ fontSize: 10, marginLeft: 6 }}>
                      unresolved
                    </span>
                  )}
                  {personal && c.conviction_label && (
                    <span style={{ marginLeft: 'auto' }}>
                      <ConvictionBadge label={c.conviction_label} />
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {papers.length > 0 && (
          <section>
            <div className="section-label">Recent research</div>
            <div className="rel-list">
              {papers.map((p) => (
                <Link key={p.id} href={`/research/${p.id}`} className="rel-item">
                  <span className="rel-kind" style={{ color: 'var(--faint-ink)' }}>paper</span>
                  <span style={{ color: 'var(--dim)' }}>
                    {p.headline ?? p.title}
                  </span>
                  {p.published_at && (
                    <span className="text-xs" style={{ color: 'var(--faint-ink)', marginLeft: 'auto' }}>
                      {p.published_at}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}
      </section>
    </>
  );
}

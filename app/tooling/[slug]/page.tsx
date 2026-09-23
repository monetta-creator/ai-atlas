import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAdmin, isPortal } from '@/lib/auth';
import { getProduct, getProductEvents, getSiblings, getToolingCategories } from '@/lib/data';
import { TOOLING_STATUS_LABEL, TOOLING_MATURITY_LABEL, TOOLING_EVENT_LABEL, dateLabel, timeAgo } from '@/lib/format';
import Header from '@/components/Header';
import ProductReviewControls from '@/components/tooling/ProductReviewControls';
import ProductFactsForm from '@/components/tooling/ProductFactsForm';
import DeepDivePanel from '@/components/tooling/DeepDivePanel';
import AgentReadPanel from '@/components/tooling/AgentReadPanel';
import ProductTools from '@/components/tooling/ProductTools';
import DeleteEventButton from '@/components/tooling/DeleteEventButton';
import ProductLogo from '@/components/tooling/ProductLogo';
import { DEPLOYMENT_LABEL, PRICING_LABEL, humanize } from '@/components/tooling/labels';
import type { ToolingViewer } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Hosts the admin/portal AI tools (enrich, score, deep dive) as server actions.
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Guest-viewer metadata read: cheap and never throws (a missing/parked
// product just falls back to the generic title; the page body 404s on its
// own admin/portal-aware read).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  try {
    const { slug } = await params;
    const product = await getProduct(slug, { admin: false, portal: false });
    return { title: `${product?.name ?? 'Product'} · AI Tooling Monitor` };
  } catch {
    return { title: 'AI Tooling Monitor' };
  }
}

function fieldRow(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline gap-2 text-sm" style={{ gap: 8 }}>
      <span style={{ color: 'var(--faint-ink)', minWidth: 130 }}>{label}</span>
      <span style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

// humanizeItems: on for extraction tags meant to read as labels (compliance
// claims, integrations, models used); off for free text the source material
// already wrote out (target buyers' own enum labels, deep-dive prose lists).
function tagList(label: string, items: string[] | undefined, humanizeItems = false) {
  if (!items?.length) return null;
  return (
    <div className="flex items-baseline flex-wrap gap-2 text-sm">
      <span style={{ color: 'var(--faint-ink)', minWidth: 130 }}>{label}</span>
      <span className="flex items-center flex-wrap gap-1.5">
        {items.map((v) => (
          <span key={v} className="badge" style={{ fontSize: 11 }}>{humanizeItems ? humanize(v) : v}</span>
        ))}
      </span>
    </div>
  );
}

// A product profile. getProduct(slugOrId, viewer) 404s for a status outside
// the viewer's set (a parked product's slug 404s for a guest). A UUID in the
// route redirects to the readable slug.
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: seg } = await params;
  const admin = await isAdmin();
  const portal = await isPortal(); // admits admins implicitly (lib/auth.ts)
  const viewer: ToolingViewer = { admin, portal };

  const product = await getProduct(seg, viewer);
  if (!product) notFound();
  if (UUID_RE.test(seg)) redirect(`/tooling/${product.slug}`);

  const [events, siblings, categories] = await Promise.all([
    getProductEvents(product.id),
    getSiblings(product.category, product.id, viewer),
    getToolingCategories(false),
  ]);
  const categoryName = categories.find((c) => c.slug === product.category)?.name ?? product.category;
  const dossier = product.dossier ?? null;
  const deepDive = product.deep_dive ?? null;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 24 }}>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
            <Link href="/tooling" className="hover:underline" style={{ color: 'inherit' }}>AI Tooling Monitor</Link>
            {' '}·{' '}
            <Link href={`/tooling?category=${product.category}`} className="hover:underline" style={{ color: 'inherit' }}>
              {categoryName}
            </Link>
          </p>
          <div className="flex items-center gap-4" style={{ marginBottom: 8 }}>
            <ProductLogo name={product.name} domain={product.vendor_domain} url={product.url} size={52} />
            <h1 style={{ margin: 0 }}>
              {product.pinned && <span role="img" aria-label="Pinned by an editor" style={{ color: 'var(--accent)', marginRight: 8 }}>★</span>}
              {product.name}
            </h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 10 }}>
            {product.one_liner ?? 'No description yet.'}
          </p>
          <div className="flex items-center flex-wrap gap-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
            {product.vendor && <span>{product.vendor}</span>}
            {product.url && (
              <a href={product.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>
                {product.vendor_domain ?? product.url} ↗
              </a>
            )}
            <span>{TOOLING_MATURITY_LABEL[product.maturity]}</span>
            {admin && <span>{TOOLING_STATUS_LABEL[product.status]}</span>}
            {!admin && portal && product.status !== 'cataloged' && (
              <span style={{ color: 'var(--heat-2)' }}>
                {product.status === 'candidate' ? 'Not yet reviewed' : 'Parked by the agent'}
              </span>
            )}
          </div>
        </header>

        <section style={{ marginBottom: 22 }}>
          <div className="section-label">Facts</div>
          <div
            className="flex flex-col gap-2 rounded-[var(--radius)] border p-3"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            {fieldRow('Description', product.description)}
            {tagList('Deployment', product.deployment.map((d) => DEPLOYMENT_LABEL[d] ?? d))}
            {fieldRow('Pricing', product.pricing_model ? PRICING_LABEL[product.pricing_model] ?? product.pricing_model : null)}
            {fieldRow('Pricing detail', product.pricing_note)}
            {fieldRow('Founded', product.founded_year)}
            {fieldRow('HQ', product.hq)}
            {fieldRow('Funding', product.funding_note)}
            {tagList('Target buyers', product.target_buyer)}
            {tagList('Integrations', product.integrations, true)}
            {tagList('Compliance claims', product.compliance_claims, true)}
            {tagList('Models used', product.models_used, true)}
            {tagList('Notable customers', product.notable_customers)}
            {product.feed_url && (
              <div className="flex items-baseline gap-2 text-sm">
                <span style={{ color: 'var(--faint-ink)', minWidth: 130 }}>Feed</span>
                <a href={product.feed_url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>
                  {product.feed_url} ↗
                </a>
              </div>
            )}
            {product.changelog_url && (
              <div className="flex items-baseline gap-2 text-sm">
                <span style={{ color: 'var(--faint-ink)', minWidth: 130 }}>Changelog</span>
                <a href={product.changelog_url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>
                  {product.changelog_url} ↗
                </a>
              </div>
            )}
            {product.github_repo && (
              <div className="flex items-baseline gap-2 text-sm">
                <span style={{ color: 'var(--faint-ink)', minWidth: 130 }}>GitHub</span>
                <a href={product.github_repo} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>
                  {product.github_repo} ↗
                </a>
              </div>
            )}
          </div>
        </section>

        {product.features.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Features · {product.features.length}</div>
            <div className="flex flex-wrap gap-1.5">
              {product.features.map((f) => <span key={f} className="badge" style={{ fontSize: 11 }}>{f}</span>)}
            </div>
          </section>
        )}

        {dossier?.summary && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Dossier · model-written summary</div>
            <div
              className="rounded-[var(--radius)] border p-3 text-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <p style={{ color: 'var(--dim)' }}>{dossier.summary}</p>
              {(dossier.customers?.length || dossier.sources?.length) ? (
                <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
                  {dossier.customers?.length ? <span>Named customers: {dossier.customers.join(' · ')}</span> : null}
                  {dossier.sources?.length ? <span>Sources: {dossier.sources.length}</span> : null}
                </div>
              ) : null}
            </div>
          </section>
        )}

        {portal && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Agent read · fit for our team, recommend-only</div>
            <AgentReadPanel fit={product.agent_fit} scores={product.agent_scores} reason={product.agent_reason} />
          </section>
        )}

        {portal && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Deep dive</div>
            {deepDive && (
              <div
                className="flex flex-col gap-2 rounded-[var(--radius)] border p-3 text-sm"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 12 }}
              >
                <p style={{ color: 'var(--dim)' }}>{deepDive.summary}</p>
                {tagList('Strengths', deepDive.strengths)}
                {tagList('Weaknesses', deepDive.weaknesses)}
                {fieldRow('Pricing detail', deepDive.pricing_detail)}
                {tagList('Compliance', deepDive.compliance)}
                {tagList('Customers', deepDive.customers)}
                {tagList('Competitors', deepDive.competitors)}
                {deepDive.recent_news.length > 0 && (
                  <div className="flex flex-col gap-1 text-sm">
                    <span style={{ color: 'var(--faint-ink)' }}>Recent news</span>
                    {deepDive.recent_news.map((n, i) => (
                      <a
                        key={`${n.url}-${i}`}
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {n.title}{n.date ? ` (${n.date})` : ''} ↗
                      </a>
                    ))}
                  </div>
                )}
                <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                  Researched {timeAgo(deepDive.researched_at)} · {deepDive.sources.length} source{deepDive.sources.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <DeepDivePanel id={product.id} />
          </section>
        )}

        <section style={{ marginBottom: 22 }}>
          <div className="section-label">Timeline · {events.length} event{events.length === 1 ? '' : 's'}</div>
          {events.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No events logged yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                    {e.event_date}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--accent)' }}>{TOOLING_EVENT_LABEL[e.kind]}</span>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--ink)', flex: 1, minWidth: 200 }}>
                      {e.title} ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--ink)', flex: 1, minWidth: 200 }}>{e.title}</span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{e.source}</span>
                  {admin && <DeleteEventButton id={e.id} />}
                  {admin && e.note && (
                    <span className="text-xs" style={{ color: 'var(--dim)', width: '100%' }}>{e.note}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {siblings.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Same category · {categoryName}</div>
            <div className="flex flex-wrap gap-2">
              {siblings.map((s) => (
                <Link key={s.id} href={`/tooling/${s.slug}`} className="touch-chip" style={{ fontSize: 12.5, padding: '5px 13px' }}>
                  {s.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {admin && (
          <>
            <section style={{ marginBottom: 22 }}>
              <div className="section-label">Review</div>
              <div
                className="rounded-[var(--radius)] border p-3"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                {product.review_note && (
                  <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 10 }}>
                    <span style={{ color: 'var(--faint-ink)' }}>Why: </span>{product.review_note}
                  </p>
                )}
                <ProductReviewControls
                  id={product.id}
                  status={product.status}
                  pinned={product.pinned}
                  reviewNote={product.review_note ?? null}
                />
              </div>
            </section>

            <section style={{ marginBottom: 22 }}>
              <div className="section-label">Tools</div>
              <ProductTools id={product.id} />
            </section>

            <section style={{ marginBottom: 22 }}>
              <ProductFactsForm product={product} categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />
            </section>

            <p className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
              {product.origin ?? 'unknown origin'}
              {product.found_url && (
                <>
                  {' · '}
                  <a href={product.found_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    source ↗
                  </a>
                </>
              )}
              {' · '}first seen {dateLabel(product.first_seen)}
              {' · '}last seen {dateLabel(product.last_seen)}
              {product.enriched_by && <>{' · '}enriched by {product.enriched_by}</>}
              {product.agent_model && <>{' · '}scored by {product.agent_model}</>}
            </p>
          </>
        )}
      </section>
    </>
  );
}

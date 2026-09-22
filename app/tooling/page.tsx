import Link from 'next/link';
import { isAdmin, isPortal, isPreview } from '@/lib/auth';
import { getEditContext } from '@/lib/content';
import { getToolingCategories, searchProducts, listToolingReports, getToolingRuns, countCataloged } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ProductFilters from '@/components/tooling/ProductFilters';
import ProductCard from '@/components/tooling/ProductCard';
import NewEntrantsStrip from '@/components/tooling/NewEntrantsStrip';
import AddProductForm from '@/components/tooling/AddProductForm';
import ToolingInfo from '@/components/tooling/ToolingInfo';
import type { ToolingViewer } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Tooling Monitor · The AI Atlas' };

const MATURITIES = new Set([
  'startup_early', 'startup_growth', 'scaleup', 'incumbent', 'big_tech', 'open_source_project', 'unknown',
]);
const DEPLOYMENTS = new Set(['saas', 'vpc', 'on_prem', 'api', 'open_source', 'desktop']);
const PRICINGS = new Set(['free', 'freemium', 'per_seat', 'usage', 'enterprise']);

function clean(v: string | undefined, allowed?: Set<string>): string | undefined {
  const s = v?.trim();
  if (!s) return undefined;
  if (allowed && !allowed.has(s)) return undefined;
  return s;
}

// The public catalog hub. Guests see cataloged products only; portal
// keyholders (isPortal() also admits admins) additionally see the agent-
// parked review queue and can add a product; admins get a link to the
// working console. preview mode renders exactly the guest view, matching
// the map's `personal = isAdmin() && !preview` convention.
export default async function ToolingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; deployment?: string; maturity?: string; pricing?: string }>;
}) {
  const [adminFlag, portalFlag, preview] = await Promise.all([isAdmin(), isPortal(), isPreview()]);
  const admin = adminFlag && !preview;
  const viewer: ToolingViewer = { admin, portal: portalFlag || admin };
  const { editing, txt } = await getEditContext();

  const sp = await searchParams;
  const q = clean(sp.q)?.slice(0, 200);
  const category = clean(sp.category);
  const deployment = clean(sp.deployment, DEPLOYMENTS);
  const maturity = clean(sp.maturity, MATURITIES);
  const pricing = clean(sp.pricing, PRICINGS);

  const [categories, products, reports, runs, total] = await Promise.all([
    getToolingCategories(false),
    searchProducts({ q, category, deployment, maturity, pricing, statuses: ['cataloged'], viewer, limit: 200 }),
    listToolingReports(viewer),
    getToolingRuns(1),
    countCataloged(),
  ]);
  const latestEntrantsReport = reports.find((r) => r.kind === 'tooling_entrants');
  const run = runs[0];
  const filtered = Boolean(q || category || deployment || maturity || pricing);

  const parked = viewer.portal
    ? await searchProducts({ statuses: ['parked'], viewer, limit: 60 })
    : [];

  // Active-only for the two forms that let a viewer PICK a category (filter
  // chips, the add form); categoryName/grouping stay on the full list so a
  // product cataloged under a category since retired still displays its name.
  const activeCategories = categories.filter((c) => c.active);
  const categoryName = new Map(categories.map((c) => [c.slug, c.name]));
  const byCategory = new Map<string, typeof products>();
  for (const p of products) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  const orderedCategories = categories.filter((c) => (byCategory.get(c.slug)?.length ?? 0) > 0);
  const uncategorized = [...byCategory.keys()].filter((slug) => !categories.some((c) => c.slug === slug));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 24 }}>
          <div className="tl-titlerow" style={{ marginBottom: 10 }}>
            <Editable
              as="h1"
              k="tooling.title"
              value={txt('tooling.title', 'AI Tooling Monitor')}
              editing={editing}
            />
            <ToolingInfo />
          </div>
          <Editable
            as="p"
            className="lede"
            k="tooling.lede"
            value={txt(
              'tooling.lede',
              'The AI tool market, cataloged weekly: what exists, how it dimensionalizes, who just entered, and what is worth building instead of buying.'
            )}
            editing={editing}
            style={{ marginBottom: 16 }}
          />
          {run ? (
            <p className="tl-cadence">
              {run.status === 'running'
                ? `Scan in progress · started ${dateLabel(run.day)} · ${run.found_count} found so far`
                : `Last scan ${dateLabel(run.day)} · ${run.found_count} found · ${run.cataloged_count} cataloged · next scan Monday 07:00 UTC`}
            </p>
          ) : (
            <p className="tl-cadence">First scan runs Monday 07:00 UTC</p>
          )}
          {admin && (
            <div
              className="flex items-center flex-wrap gap-3 rounded-[var(--radius)] border p-3 text-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <span style={{ color: 'var(--dim)' }}>The desk: engine runs, prefs, categories, curation, datasets.</span>
              <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <Link href="/tooling/console" className="btn btn--ghost btn--sm">Console →</Link>
                <Link href="/tooling/reports" className="btn btn--ghost btn--sm">Reports →</Link>
              </span>
            </div>
          )}
        </header>

        <div className="tl-filters">
          <form action="/tooling" method="GET" className="flex items-center gap-2" style={{ marginBottom: 16, maxWidth: 480 }}>
            <input type="hidden" name="category" value={category ?? ''} />
            <input type="hidden" name="deployment" value={deployment ?? ''} />
            <input type="hidden" name="maturity" value={maturity ?? ''} />
            <input type="hidden" name="pricing" value={pricing ?? ''} />
            <input
              type="text"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search products…"
              aria-label="Search products"
              className="input"
            />
            <button type="submit" className="btn btn--primary btn--sm">Search</button>
          </form>

          <ProductFilters
            categories={activeCategories.map((c) => ({ slug: c.slug, name: c.name }))}
            current={{ q, category, deployment, maturity, pricing }}
          />
        </div>

        <NewEntrantsStrip
          viewer={viewer}
          reportHref={latestEntrantsReport ? `/reports/sheet/${latestEntrantsReport.id}` : null}
        />

        {viewer.portal && (
          <>
            <details className="tl-details" style={{ marginBottom: 22 }}>
              <summary className="text-sm" style={{ color: 'var(--dim)' }}>
                Held for review · {parked.length}
              </summary>
              <div className="flex flex-col gap-1" style={{ marginTop: 10 }}>
                <p className="tl-note">
                  Scored below the catalog threshold, or the homepage never fetched. Visible to team keyholders and admins only.
                </p>
                {parked.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>Nothing parked right now.</p>
                ) : (
                  parked.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                    >
                      <Link href={`/tooling/${p.slug}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                        {p.name}
                      </Link>
                      {p.one_liner && <span style={{ color: 'var(--dim)', flex: 1, minWidth: 200 }}>{p.one_liner}</span>}
                      <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                        {categoryName.get(p.category) ?? p.category}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </details>

            <details className="tl-details" style={{ marginBottom: 26 }}>
              <summary className="text-sm" style={{ color: 'var(--dim)' }}>
                Add a product…
              </summary>
              <div style={{ marginTop: 10 }}>
                <p className="tl-note">
                  Lands as a candidate and is scored on the next run. If discovery already found it, you are routed to the existing entry.
                </p>
                <AddProductForm categories={activeCategories.map((c) => ({ slug: c.slug, name: c.name }))} />
              </div>
            </details>
          </>
        )}

        <p className="text-sm" style={{ color: 'var(--faint-ink)', marginBottom: 18 }}>
          {filtered
            ? `${products.length} of ${total} products match`
            : `${total} cataloged product${total === 1 ? '' : 's'} across ${orderedCategories.length} categor${orderedCategories.length === 1 ? 'y' : 'ies'}`}
        </p>

        {products.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
            {q ? `No products match “${q}”.` : 'No cataloged products in this selection yet.'}
            {' '}
            <Link href="/tooling" style={{ color: 'var(--accent)' }}>Clear filters</Link>
          </p>
        ) : (
          [...orderedCategories.map((c) => c.slug), ...uncategorized].map((slug) => {
            const list = byCategory.get(slug) ?? [];
            if (!list.length) return null;
            return (
              <section key={slug} style={{ marginBottom: 26 }}>
                <div className="section-label">{categoryName.get(slug) ?? slug} · {list.length}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                  {list.map((p) => <ProductCard key={p.id} product={p} />)}
                </div>
              </section>
            );
          })
        )}
      </section>
    </>
  );
}

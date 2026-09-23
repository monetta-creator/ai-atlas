import { isAdmin, isPortal, isPreview } from '@/lib/auth';
import { getToolingCategories, searchProducts } from '@/lib/data';
import { toTableRow } from '@/lib/tooling/table-core';
import PageTop from '@/components/PageTop';
import ProductFilters from '@/components/tooling/ProductFilters';
import ProductTable from '@/components/tooling/ProductTable';
import type { ToolingViewer } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tooling table · The AI Atlas' };

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

// A sortable, filterable, paginated spreadsheet view over the same cataloged
// products /tooling shows as cards. Same viewer computation and facet parsing
// as app/tooling/page.tsx, so the two surfaces agree on what "cataloged" and
// "portal" mean; only the presentation differs.
export default async function ToolingTablePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; deployment?: string; maturity?: string; pricing?: string }>;
}) {
  const [adminFlag, portalFlag, preview] = await Promise.all([isAdmin(), isPortal(), isPreview()]);
  const admin = adminFlag && !preview;
  const viewer: ToolingViewer = { admin, portal: portalFlag || admin };

  const sp = await searchParams;
  const q = clean(sp.q)?.slice(0, 200);
  const category = clean(sp.category);
  const deployment = clean(sp.deployment, DEPLOYMENTS);
  const maturity = clean(sp.maturity, MATURITIES);
  const pricing = clean(sp.pricing, PRICINGS);

  const [categories, products] = await Promise.all([
    getToolingCategories(false),
    searchProducts({ q, category, deployment, maturity, pricing, statuses: ['cataloged'], viewer, limit: 500 }),
  ]);
  const activeCategories = categories.filter((c) => c.active);
  const categoryName = new Map(categories.map((c) => [c.slug, c.name]));
  const rows = products.map((p) => toTableRow(p, categoryName.get(p.category) ?? p.category));

  return (
    <>
      <section className="wrap" style={{ maxWidth: 1360, paddingBottom: 100 }}>
        <PageTop pathname="/tooling/table" label="Tooling table" viewer={{ admin, portal: viewer.portal }} />

        <div className="tl-filters">
          <ProductFilters
            base="/tooling/table"
            categories={activeCategories.map((c) => ({ slug: c.slug, name: c.name }))}
            current={{ q, category, deployment, maturity, pricing }}
          />
        </div>

        <ProductTable
          rows={rows}
          portal={viewer.portal}
          admin={viewer.admin}
          csvHref={viewer.portal ? '/api/datasets/tooling-products?download=1' : '/api/datasets/tooling-catalog?download=1'}
        />
      </section>
    </>
  );
}

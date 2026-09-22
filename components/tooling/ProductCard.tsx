import Link from 'next/link';
import { TOOLING_MATURITY_LABEL, dateLabel } from '@/lib/format';
import { fitBand } from '@/lib/tooling/report-core';
import { DEPLOYMENT_LABEL, PRICING_LABEL, FIT_BAND_LABEL } from './labels';
import type { ToolingProduct } from '@/lib/types';

// A catalog card for the /tooling grid. agent_fit/agent_scores/etc are portal-
// or admin-only columns (lib/data/tooling.ts's PRODUCT_PORTAL_COLUMNS): they
// simply aren't present on a guest's row, so fitBand naturally returns null
// and the "fit" chip disappears rather than needing a separate viewer prop.
export default function ProductCard({ product }: { product: ToolingProduct }) {
  const band = fitBand(product.agent_fit ?? null);
  const meta = [
    ...(product.maturity !== 'unknown' ? [TOOLING_MATURITY_LABEL[product.maturity]] : []),
    ...product.deployment.map((d) => DEPLOYMENT_LABEL[d] ?? d),
    ...(product.pricing_model && product.pricing_model !== 'unknown'
      ? [PRICING_LABEL[product.pricing_model] ?? product.pricing_model]
      : []),
    `first seen ${dateLabel(product.first_seen)}`,
  ];
  return (
    <Link
      href={`/tooling/${product.slug}`}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-2"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)', textDecoration: 'none' }}
    >
      <span className="flex items-baseline gap-2 flex-wrap">
        {product.pinned && <span role="img" aria-label="Pinned by an editor" style={{ color: 'var(--accent)' }}>★</span>}
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15.5 }}>{product.name}</span>
        {product.vendor && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{product.vendor}</span>
        )}
      </span>
      {product.one_liner && <span className="text-sm" style={{ color: 'var(--dim)' }}>{product.one_liner}</span>}
      <span className="flex items-center flex-wrap gap-2 text-xs">
        <span className="tl-meta">{meta.join(' · ')}</span>
        {band && (
          <span className="tl-fit" title={`Agent fit ${product.agent_fit}/100 on the team rubric, recommend-only`}>
            ✦ {FIT_BAND_LABEL[band]}
          </span>
        )}
      </span>
      {product.features.length > 0 && (
        <span className="flex items-center flex-wrap gap-1.5">
          {product.features.slice(0, 5).map((f) => (
            <span key={f} className="badge" style={{ fontSize: 11 }}>{f}</span>
          ))}
        </span>
      )}
    </Link>
  );
}

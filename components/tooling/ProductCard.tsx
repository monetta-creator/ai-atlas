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
  return (
    <Link
      href={`/tooling/${product.slug}`}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-2"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)', textDecoration: 'none' }}
    >
      <span className="flex items-baseline gap-2 flex-wrap">
        {product.pinned && <span title="Pinned by an editor" style={{ color: 'var(--accent)' }}>★</span>}
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15.5 }}>{product.name}</span>
        {product.vendor && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{product.vendor}</span>
        )}
      </span>
      {product.one_liner && <span className="text-sm" style={{ color: 'var(--dim)' }}>{product.one_liner}</span>}
      <span className="flex items-center flex-wrap gap-2 text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
        <span>{TOOLING_MATURITY_LABEL[product.maturity]}</span>
        {product.deployment.map((d) => <span key={d}>{DEPLOYMENT_LABEL[d] ?? d}</span>)}
        {product.pricing_model && <span>{PRICING_LABEL[product.pricing_model] ?? product.pricing_model}</span>}
        <span>since {dateLabel(product.first_seen)}</span>
        {band && <span style={{ color: 'var(--accent)' }}>✦ {FIT_BAND_LABEL[band]}</span>}
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

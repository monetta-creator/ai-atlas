'use client';

import Link from 'next/link';
import { TOOLING_MATURITY_LABEL } from '@/lib/format';
import { DEPLOYMENT_LABEL, DEPLOYMENT_OPTIONS, PRICING_LABEL, PRICING_OPTIONS } from './labels';
import type { ToolingMaturity } from '@/lib/types';

const MATURITIES = Object.keys(TOOLING_MATURITY_LABEL) as ToolingMaturity[];

interface Filters {
  q?: string;
  category?: string;
  deployment?: string;
  maturity?: string;
  pricing?: string;
}

function toQs(next: Filters): string {
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.category) params.set('category', next.category);
  if (next.deployment) params.set('deployment', next.deployment);
  if (next.maturity) params.set('maturity', next.maturity);
  if (next.pricing) params.set('pricing', next.pricing);
  const qs = params.toString();
  return `/tooling${qs ? `?${qs}` : ''}`;
}

// Builds the /tooling URL for one chip: toggling the SAME value off (an
// active chip clears itself), otherwise replacing that dimension's value
// while carrying every other current filter (including q) forward.
function chipHref(current: Filters, key: keyof Filters, value: string): string {
  const next: Filters = { ...current };
  if (next[key] === value) delete next[key];
  else next[key] = value;
  return toQs(next);
}

// The URL with one dimension dropped, everything else carried forward (the
// search chip's × and, per-dimension, a future per-chip clear).
function hrefWithout(current: Filters, key: keyof Filters): string {
  const next: Filters = { ...current };
  delete next[key];
  return toQs(next);
}

function ChipRow({
  label, current, filterKey, options,
}: {
  label: string;
  current: Filters;
  filterKey: keyof Filters;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center flex-wrap gap-2" style={{ marginBottom: 8 }}>
      <span className="text-xs" style={{ color: 'var(--faint-ink)', minWidth: 82 }}>{label}</span>
      {options.map((o) => {
        const active = current[filterKey] === o.value;
        return (
          <Link
            key={o.value}
            href={chipHref(current, filterKey, o.value)}
            className="touch-chip"
            data-on={active ? '' : undefined}
            style={{ fontSize: 12, padding: '5px 13px' }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

// searchParams-driven filter chips: every chip is a plain link that rewrites
// the /tooling URL, so the filtered view is bookmarkable and needs no client
// state. Marked 'use client' per spec; the chips themselves are static links.
export default function ProductFilters({
  categories, current,
}: {
  categories: { slug: string; name: string }[];
  current: Filters;
}) {
  const anyActive = Boolean(current.q || current.category || current.deployment || current.maturity || current.pricing);
  return (
    <div style={{ marginBottom: 18 }}>
      {current.q && (
        <div className="flex items-center flex-wrap gap-2" style={{ marginBottom: 8 }}>
          <span className="text-xs" style={{ color: 'var(--faint-ink)', minWidth: 82 }}>Search</span>
          <Link
            href={hrefWithout(current, 'q')}
            className="touch-chip"
            data-on=""
            style={{ fontSize: 12, padding: '5px 13px' }}
          >
            Search: &ldquo;{current.q}&rdquo; ×
          </Link>
        </div>
      )}
      <ChipRow
        label="Category"
        current={current}
        filterKey="category"
        options={categories.map((c) => ({ value: c.slug, label: c.name }))}
      />
      <ChipRow
        label="Deployment"
        current={current}
        filterKey="deployment"
        options={DEPLOYMENT_OPTIONS.map((d) => ({ value: d, label: DEPLOYMENT_LABEL[d] }))}
      />
      <ChipRow
        label="Maturity"
        current={current}
        filterKey="maturity"
        options={MATURITIES.map((m) => ({ value: m, label: TOOLING_MATURITY_LABEL[m] }))}
      />
      <ChipRow
        label="Pricing"
        current={current}
        filterKey="pricing"
        options={PRICING_OPTIONS.map((p) => ({ value: p, label: PRICING_LABEL[p] }))}
      />
      {anyActive && (
        <div className="flex items-center justify-end">
          <Link href="/tooling" className="tl-clear">Clear all ×</Link>
        </div>
      )}
    </div>
  );
}

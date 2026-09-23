'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TOOLING_MATURITY_LABEL } from '@/lib/format';
import { DEPLOYMENT_LABEL, DEPLOYMENT_OPTIONS, PRICING_LABEL, PRICING_OPTIONS } from './labels';
import type { ToolingMaturity } from '@/lib/types';

const MATURITIES = Object.keys(TOOLING_MATURITY_LABEL) as ToolingMaturity[];

export interface Filters {
  q?: string;
  category?: string;
  deployment?: string;
  maturity?: string;
  pricing?: string;
}

export function filtersHref(next: Filters, base = '/tooling'): string {
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.category) params.set('category', next.category);
  if (next.deployment) params.set('deployment', next.deployment);
  if (next.maturity) params.set('maturity', next.maturity);
  if (next.pricing) params.set('pricing', next.pricing);
  const qs = params.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

// One toolbar row: the search box plus four dropdowns, one per facet. Every
// control writes the /tooling URL (a select change navigates immediately,
// the search box on submit), so the filtered view stays bookmarkable and the
// server does the FTS. The category headings in the grid below link to
// ?category=, so browsing by category never depended on the old chip wall.
export default function ProductFilters({
  categories, current, base = '/tooling',
}: {
  categories: { slug: string; name: string }[];
  current: Filters;
  base?: string;
}) {
  const router = useRouter();
  const anyActive = Boolean(current.q || current.category || current.deployment || current.maturity || current.pricing);

  function set(key: keyof Filters, value: string) {
    const next: Filters = { ...current };
    if (value) next[key] = value;
    else delete next[key];
    router.push(filtersHref(next, base));
  }

  return (
    <form
      className="tl-toolbar"
      action={base}
      method="GET"
      onSubmit={(e) => {
        e.preventDefault();
        const q = (new FormData(e.currentTarget).get('q') as string | null)?.trim() ?? '';
        set('q', q);
      }}
    >
      <input
        type="search"
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Search products…"
        aria-label="Search products"
        className="input tl-search"
      />
      <label className="tl-select">
        <span>Category</span>
        <select value={current.category ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>
      <label className="tl-select">
        <span>Deployment</span>
        <select value={current.deployment ?? ''} onChange={(e) => set('deployment', e.target.value)}>
          <option value="">Any</option>
          {DEPLOYMENT_OPTIONS.map((d) => <option key={d} value={d}>{DEPLOYMENT_LABEL[d]}</option>)}
        </select>
      </label>
      <label className="tl-select">
        <span>Maturity</span>
        <select value={current.maturity ?? ''} onChange={(e) => set('maturity', e.target.value)}>
          <option value="">Any</option>
          {MATURITIES.map((m) => <option key={m} value={m}>{TOOLING_MATURITY_LABEL[m]}</option>)}
        </select>
      </label>
      <label className="tl-select">
        <span>Pricing</span>
        <select value={current.pricing ?? ''} onChange={(e) => set('pricing', e.target.value)}>
          <option value="">Any</option>
          {PRICING_OPTIONS.map((p) => <option key={p} value={p}>{PRICING_LABEL[p]}</option>)}
        </select>
      </label>
      {anyActive && <Link href={base} className="tl-clear">Clear all ×</Link>}
    </form>
  );
}

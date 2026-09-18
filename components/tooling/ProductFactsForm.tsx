'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProductFactsAction } from '@/lib/actions';
import { TOOLING_MATURITY_LABEL } from '@/lib/format';
import {
  DEPLOYMENT_LABEL, DEPLOYMENT_OPTIONS, PRICING_LABEL, PRICING_OPTIONS,
  TARGET_BUYER_LABEL, TARGET_BUYER_OPTIONS,
} from './labels';
import type { ToolingMaturity, ToolingProduct } from '@/lib/types';

const MATURITIES = Object.keys(TOOLING_MATURITY_LABEL) as ToolingMaturity[];

// Array fields the action reads as a JSON string (lib/actions/shared.ts's
// parseStringArray does JSON.parse), edited here as a comma-separated text
// input for anything free-form.
const CSV_FIELDS = [
  'secondary_categories', 'notable_customers', 'integrations', 'compliance_claims', 'models_used', 'features',
] as const;
// Fixed-vocabulary array fields: plain checkboxes sharing one name, so
// FormData.getAll already returns the checked list natively.
const CHECKBOX_FIELDS = ['target_buyer', 'deployment'] as const;

const toCsv = (list: string[] | undefined): string => (list ?? []).join(', ');
const fromCsv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

// The human's overwrite of the extracted/dossier facts: a human edit always
// wins over enrichment (updateProductFacts sets directly, no coalesce).
// Client-side because two of the action's fields are JSON-encoded arrays
// (parseStringArray), which a plain <form action> can't produce on its own.
export default function ProductFactsForm({
  product, categories,
}: {
  product: ToolingProduct;
  categories: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    for (const f of CHECKBOX_FIELDS) {
      const vals = fd.getAll(f).map(String);
      fd.set(f, JSON.stringify(vals));
    }
    for (const f of CSV_FIELDS) {
      const raw = String(fd.get(`${f}_csv`) ?? '');
      fd.set(f, JSON.stringify(fromCsv(raw)));
      fd.delete(`${f}_csv`);
    }
    startTransition(async () => {
      try {
        await updateProductFactsAction(fd);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed.');
      }
    });
  }

  return (
    <details>
      <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
        Edit the facts…
      </summary>
      <form
        onSubmit={onSubmit}
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 640 }}
      >
        <input type="hidden" name="id" value={product.id} />

        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 2, minWidth: 180 }}>
            <label htmlFor="pf-name">Name</label>
            <input id="pf-name" name="name" className="input" required maxLength={200} defaultValue={product.name} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="pf-vendor">Vendor</label>
            <input id="pf-vendor" name="vendor" className="input" maxLength={200} defaultValue={product.vendor ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="pf-vendor-domain">Vendor domain</label>
            <input id="pf-vendor-domain" name="vendor_domain" className="input" maxLength={200} defaultValue={product.vendor_domain ?? ''} />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="pf-url">Homepage URL</label>
            <input id="pf-url" name="url" className="input" type="url" defaultValue={product.url ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="pf-category">Category</label>
            <select id="pf-category" name="category" className="input" required defaultValue={product.category}>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pf-secondary">Secondary categories (comma separated slugs)</label>
          <input id="pf-secondary" name="secondary_categories_csv" className="input" defaultValue={toCsv(product.secondary_categories)} />
        </div>

        <div className="field">
          <label htmlFor="pf-oneliner">One-liner</label>
          <input id="pf-oneliner" name="one_liner" className="input" maxLength={300} defaultValue={product.one_liner ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="pf-description">Description</label>
          <textarea id="pf-description" name="description" className="input" rows={3} defaultValue={product.description ?? ''} />
        </div>

        <div className="field">
          <label>Target buyer</label>
          <div className="flex flex-wrap gap-3 text-sm" style={{ color: 'var(--dim)' }}>
            {TARGET_BUYER_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" name="target_buyer" value={o} defaultChecked={product.target_buyer.includes(o)} />
                {TARGET_BUYER_LABEL[o]}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Deployment</label>
          <div className="flex flex-wrap gap-3 text-sm" style={{ color: 'var(--dim)' }}>
            {DEPLOYMENT_OPTIONS.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" name="deployment" value={o} defaultChecked={product.deployment.includes(o)} />
                {DEPLOYMENT_LABEL[o]}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label htmlFor="pf-pricing-model">Pricing model</label>
            <select id="pf-pricing-model" name="pricing_model" className="input" defaultValue={product.pricing_model ?? 'unknown'}>
              {[...PRICING_OPTIONS, 'unknown'].map((p) => (
                <option key={p} value={p}>{PRICING_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label htmlFor="pf-pricing-note">Pricing note</label>
            <input id="pf-pricing-note" name="pricing_note" className="input" maxLength={300} defaultValue={product.pricing_note ?? ''} />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="pf-maturity">Maturity</label>
            <select id="pf-maturity" name="maturity" className="input" defaultValue={product.maturity}>
              {MATURITIES.map((m) => (
                <option key={m} value={m}>{TOOLING_MATURITY_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 110 }}>
            <label htmlFor="pf-founded">Founded</label>
            <input id="pf-founded" name="founded_year" className="input" inputMode="numeric" defaultValue={product.founded_year ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="pf-hq">HQ</label>
            <input id="pf-hq" name="hq" className="input" maxLength={120} defaultValue={product.hq ?? ''} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="pf-funding">Funding note</label>
          <input id="pf-funding" name="funding_note" className="input" maxLength={200} defaultValue={product.funding_note ?? ''} />
        </div>

        <div className="field">
          <label htmlFor="pf-customers">Notable customers (comma separated)</label>
          <input id="pf-customers" name="notable_customers_csv" className="input" defaultValue={toCsv(product.notable_customers)} />
        </div>
        <div className="field">
          <label htmlFor="pf-integrations">Integrations (comma separated)</label>
          <input id="pf-integrations" name="integrations_csv" className="input" defaultValue={toCsv(product.integrations)} />
        </div>
        <div className="field">
          <label htmlFor="pf-compliance">Compliance claims (comma separated)</label>
          <input id="pf-compliance" name="compliance_claims_csv" className="input" defaultValue={toCsv(product.compliance_claims)} />
        </div>
        <div className="field">
          <label htmlFor="pf-models">Models used (comma separated)</label>
          <input id="pf-models" name="models_used_csv" className="input" defaultValue={toCsv(product.models_used)} />
        </div>
        <div className="field">
          <label htmlFor="pf-features">Features (comma separated)</label>
          <input id="pf-features" name="features_csv" className="input" defaultValue={toCsv(product.features)} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="pf-feed">Feed URL</label>
            <input id="pf-feed" name="feed_url" className="input" defaultValue={product.feed_url ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="pf-changelog">Changelog URL</label>
            <input id="pf-changelog" name="changelog_url" className="input" defaultValue={product.changelog_url ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="pf-github">GitHub repo</label>
            <input id="pf-github" name="github_repo" className="input" defaultValue={product.github_repo ?? ''} />
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save facts'}
          </button>
        </div>
        {error && <span className="text-xs" style={{ color: 'var(--heat-4)' }}>{error}</span>}
      </form>
    </details>
  );
}

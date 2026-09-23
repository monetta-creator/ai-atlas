import Link from 'next/link';
import { getPortalIdentity } from '@/lib/portal/identity';
import { SIGNAL_LENSES } from '@/lib/datasets/core';
import { DATASETS } from '@/lib/datasets/registry';
import { getEditContext } from '@/lib/content';
import PageTop from '@/components/PageTop';
import Editable from '@/components/Editable';
import RenewalNotice, { type RenewalState } from '@/components/portal/RenewalNotice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Portal · The AI Atlas' };

// The public Datasets portal hub: the catalog of downloadable datasets (public
// ones guest-safe, the key-gated exports behind the access key) plus the door
// to the team Ask surface. Nothing here calls a model. Every registry category
// must appear in `categories` below or its datasets never render. The enter
// link lands here with ?key=expired|revoked when a lapsed key was used, so
// the notice renders even before the cookie identity says so.
export default async function DatasetsPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const [identity, sp] = await Promise.all([getPortalIdentity(), searchParams]);
  const admin = identity.tier === 'admin';
  const portal = identity.active;
  const notice: RenewalState | null = identity.state === 'expired' || identity.state === 'revoked'
    ? identity
    : sp.key === 'expired' || sp.key === 'revoked'
      ? { state: sp.key, expiresAt: null }
      : null;
  const { editing, txt } = await getEditContext();
  const categories: { key: string; label: string }[] = [
    { key: 'signals', label: 'Signals' },
    { key: 'evidence', label: 'Evidence' },
    { key: 'argument-graph', label: 'Argument graph' },
    { key: 'sources', label: 'Sources' },
    { key: 'research', label: 'Research' },
    { key: 'scout', label: 'Startup Scout' },
    { key: 'scan', label: 'External scan' },
    { key: 'intel', label: 'Company intel' },
    { key: 'tooling', label: 'Tooling Monitor' },
    { key: 'meta', label: 'Meta' },
  ];

  return (
    <>
      <section className="wrap" style={{ paddingBottom: 100 }}>
        <PageTop
          pathname="/datasets"
          label="Data Portal"
          viewer={{ admin, portal }}
          title={
            <Editable
              as="h1"
              k="datasets.title"
              value={txt('datasets.title', 'Data Portal')}
              editing={editing}
            />
          }
          action={
            <>
              {!portal && <Link href="/datasets/request" className="btn btn--ghost">Request access</Link>}
              <Link href="/ask" className="btn btn--primary">Ask the Atlas</Link>
            </>
          }
        />

        <RenewalNotice identity={notice} style={{ marginBottom: 24 }} />

        {categories.map((cat) => {
          const list = DATASETS.filter((d) => d.category === cat.key);
          if (!list.length) return null;
          return (
            <div key={cat.key} style={{ marginBottom: 34 }}>
              <div className="section-label">{cat.label}</div>
              <div className="flex flex-col gap-[var(--gap)]" style={{ marginTop: 14 }}>
                {list.map((d) => (
                  <div key={d.slug} className="plate" style={{ padding: 'var(--card-pad)' }}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div style={{ maxWidth: 640 }}>
                        <Link href={`/datasets/${d.slug}`} prefetch={false} style={{ textDecoration: 'none', color: 'var(--ink)' }}>
                          <h3 style={{ marginBottom: 6 }}>{d.title}</h3>
                        </Link>
                        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--dim)', marginBottom: 10 }}>
                          {d.description}
                        </p>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                          {d.slug} · {d.columns.length} columns · CSV / JSON
                          {d.keyGated ? ' · access key required' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 2 }}>
                        <a className="btn btn--ghost btn--sm" href={`/api/datasets/${d.slug}`}>CSV</a>
                        <a className="btn btn--quiet btn--sm" href={`/api/datasets/${d.slug}?format=json`}>JSON</a>
                        <Link className="btn btn--quiet btn--sm" href={`/datasets/${d.slug}`} prefetch={false}>
                          Schema
                        </Link>
                      </div>
                    </div>
                    {d.filters?.lens && (
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 14 }}>
                        <span className="lbl" style={{ fontSize: 9.5 }}>lens slices</span>
                        {SIGNAL_LENSES.map((lens) => (
                          <a
                            key={lens}
                            className="btn btn--quiet btn--sm"
                            href={`/api/datasets/${d.slug}?lens=${lens}`}
                            title={`Download the ${lens} slice as CSV`}
                          >
                            {lens}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <p style={{ fontSize: 12.5, color: 'var(--faint-ink)', lineHeight: 1.7, maxWidth: 640 }}>
          Public datasets carry only the published layer of the Atlas. The key-gated exports add
          retained article text and machine-extracted records; the argument map&apos;s personal layer
          (confidence values, rationales, source reliability priors) never enters any download, and
          the one reviewer-set value that does ship, the research export&apos;s rigor prior, rides only
          behind the access key. Retained article text is an internal working corpus; link to the
          original source when sharing outward.
        </p>
      </section>
    </>
  );
}

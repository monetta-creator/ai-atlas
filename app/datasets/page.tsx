import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import { SIGNAL_LENSES } from '@/lib/datasets/core';
import { DATASETS } from '@/lib/datasets/registry';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data Portal · The AI Atlas' };

// The public Datasets portal hub: the catalog of downloadable, guest-safe
// datasets plus the door to the team Ask surface. Nothing here calls a model.
export default async function DatasetsPage() {
  const admin = await isAdmin();
  const categories: { key: string; label: string }[] = [
    { key: 'signals', label: 'Signals' },
    { key: 'evidence', label: 'Evidence' },
    { key: 'argument-graph', label: 'Argument graph' },
    { key: 'sources', label: 'Sources' },
    { key: 'research', label: 'Research' },
    { key: 'scout', label: 'Startup Scout' },
    { key: 'scan', label: 'External scan' },
    { key: 'meta', label: 'Meta' },
  ];

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ paddingBottom: 100 }}>
        <div className="crumbs">Data Portal</div>
        <header className="pagehead" style={{ padding: '24px 0 28px' }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1>Data Portal</h1>
              <p className="lede">
                The Atlas as data: every published signal, claim, evidence row, concept, and report,
                downloadable as CSV or JSON with a documented schema. Built for analysts: filter and
                group in the browser, pull a file into Sheets or a notebook, or ask in plain language
                and get a cited answer with the right dataset attached.
              </p>
            </div>
            <Link href="/ask" className="btn btn--primary" style={{ marginTop: 6, whiteSpace: 'nowrap' }}>
              Ask the Atlas
            </Link>
          </div>
        </header>

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
                          {d.keyGated ? ' · team key required' : ''}
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
          Every dataset carries only the published, public layer of the Atlas: personal confidence
          values, rationales, and source priors never enter a download. Full article text is an
          internal working corpus; link to the original source when sharing outward.
        </p>
      </section>
    </>
  );
}

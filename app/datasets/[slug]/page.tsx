import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPortal } from '@/lib/auth';
import { SIGNAL_LENSES } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import PageTop from '@/components/PageTop';
import DatasetSchemaTable from '@/components/datasets/DatasetSchemaTable';
import DatasetExplorer from '@/components/datasets/DatasetExplorer';
import DatasetPreview from '@/components/datasets/DatasetPreview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dataset · The AI Atlas' };

// A dataset's public page: description, methodology, the auto-generated schema
// table, downloads, and the in-browser explorer. Heavy datasets (bulk article
// text) skip the explorer and, when key-gated, preview only for portal holders.
export default async function DatasetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) notFound();

  const [admin, portal] = await Promise.all([isAdmin(), isPortal()]);
  const unlocked = !def.keyGated || portal;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname={`/datasets/${def.slug}`}
          label={def.title.slice(0, 60)}
          compact
          title={<h1>{def.title}</h1>}
          viewer={{ admin, portal: portal || admin }}
          infoKey="/datasets/[slug]"
          action={unlocked ? (
            <>
              <a className="btn btn--primary btn--sm" href={`/api/datasets/${def.slug}`}>Download CSV</a>
              <a className="btn btn--ghost btn--sm" href={`/api/datasets/${def.slug}?format=json`}>JSON</a>
            </>
          ) : (
            <Link className="btn btn--primary btn--sm" href="/ask">
              Unlock with the team key
            </Link>
          )}
        >
          /api/datasets/{def.slug} · {def.columns.length} columns{def.keyGated ? ' · team key required' : ''}
        </PageTop>

        <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 10 }}>{def.description}</p>

        {def.filters?.lens && (
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
            <span className="lbl" style={{ fontSize: 9.5 }}>lens slices</span>
            {SIGNAL_LENSES.map((lens) => (
              <a key={lens} className="btn btn--quiet btn--sm" href={`/api/datasets/${def.slug}?lens=${lens}`}>
                {lens}
              </a>
            ))}
          </div>
        )}

        <div style={{ margin: '26px 0' }}>
          <div className="section-label">Methodology</div>
          <p style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: 'var(--dim)', maxWidth: 720 }}>
            {def.methodology}
          </p>
        </div>

        <div style={{ margin: '26px 0' }}>
          <div className="section-label">Schema</div>
          <div style={{ marginTop: 12 }}>
            <DatasetSchemaTable columns={def.columns} />
          </div>
        </div>

        <div style={{ margin: '26px 0' }}>
          <div className="section-label">{def.heavy ? 'Preview' : 'Explore'}</div>
          <div style={{ marginTop: 12 }}>
            {!def.heavy ? (
              <DatasetExplorer slug={def.slug} columns={def.columns} />
            ) : unlocked ? (
              <DatasetPreview slug={def.slug} columns={def.columns} />
            ) : (
              <p style={{ fontSize: 13, color: 'var(--faint-ink)', maxWidth: 640, lineHeight: 1.7 }}>
                This dataset holds the complete retained article text, so the preview and download
                sit behind the shared team key. Unlock once at the Ask page and both open up.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

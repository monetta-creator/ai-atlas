import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPortal } from '@/lib/auth';
import { q } from '@/lib/db';
import { SIGNAL_CONTEXTS, type DatasetRow } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import Header from '@/components/Header';
import DatasetSchemaTable from '@/components/datasets/DatasetSchemaTable';
import DatasetExplorer from '@/components/datasets/DatasetExplorer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dataset · The Strategy Atlas' };

// A dataset's public page: description, methodology, the auto-generated schema
// table, downloads, and the in-browser explorer. Heavy datasets (bulk article
// text) skip the explorer and, when key-gated, preview only for portal holders.
export default async function DatasetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) notFound();

  const [admin, portal] = await Promise.all([isAdmin(), isPortal()]);
  const unlocked = !def.keyGated || portal;

  // Heavy datasets get a small server-rendered preview instead of the explorer;
  // longtext cells are clipped hard so bulk text never ships to the page.
  let heavyPreview: DatasetRow[] = [];
  if (def.heavy && unlocked) {
    const rows = await def.build(q);
    heavyPreview = rows.slice(0, 5).map((r) => {
      const out: DatasetRow = {};
      for (const c of def.columns) {
        const v = r[c.key] ?? null;
        out[c.key] =
          c.type === 'longtext' && typeof v === 'string' && v.length > 160
            ? `${v.slice(0, 160)}…`
            : v;
      }
      return out;
    });
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/datasets">Data Portal</Link> / {def.slug}
        </div>
        <header className="pagehead" style={{ padding: '24px 0 24px' }}>
          <h1>{def.title}</h1>
          <p className="lede">{def.description}</p>
          <div style={{ marginTop: 10, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
            /api/datasets/{def.slug} · {def.columns.length} columns
            {def.keyGated ? ' · team key required' : ''}
          </div>
        </header>

        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
          {unlocked ? (
            <>
              <a className="btn btn--primary btn--sm" href={`/api/datasets/${def.slug}`}>Download CSV</a>
              <a className="btn btn--ghost btn--sm" href={`/api/datasets/${def.slug}?format=json`}>JSON</a>
            </>
          ) : (
            <Link className="btn btn--primary btn--sm" href="/ask">
              Unlock with the team key
            </Link>
          )}
        </div>
        {def.filters?.context && (
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
            <span className="lbl" style={{ fontSize: 9.5 }}>context slices</span>
            {SIGNAL_CONTEXTS.map((context) => (
              <a key={context} className="btn btn--quiet btn--sm" href={`/api/datasets/${def.slug}?context=${context}`}>
                {context}
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
              heavyPreview.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="viewdata-table">
                    <thead>
                      <tr>
                        {def.columns.map((c) => (
                          <th key={c.key} className="vd-label">{c.key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heavyPreview.map((r, i) => (
                        <tr key={i}>
                          {def.columns.map((c) => (
                            <td key={c.key} className={c.type === 'number' ? 'vd-num' : 'vd-label'}>
                              {r[c.key] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--faint-ink)' }}>No rows yet.</p>
              )
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

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortalIdentity } from '@/lib/portal/identity';
import { getView } from '@/lib/data';
import { canReadView } from '@/lib/portal/views-core';
import { SIGNAL_LENSES } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import { fieldEnumValues } from '@/lib/datasets/handoff-shared';
import { fromSearchParams } from '@/lib/datasets/query-url';
import PageTop from '@/components/PageTop';
import DatasetSchemaTable from '@/components/datasets/DatasetSchemaTable';
import QueryBuilder from '@/components/datasets/QueryBuilder';
import RenewalNotice from '@/components/portal/RenewalNotice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dataset · The AI Atlas' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A dataset's public page: description, methodology, the auto-generated schema
// table, downloads, and the query builder (components/datasets/QueryBuilder,
// over lib/datasets/query-url's translation of the download route's own
// where/cols/sort/limit/q grammar). The builder renders for every dataset,
// heavy or key-gated included: it is the one surface that also runs the
// small-preview fetch DatasetPreview used to handle on this page, and it
// shows its own Unlock/Request-access links when the viewer has not
// unlocked a key-gated dataset, rather than the page hiding it outright.
export default async function DatasetPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) notFound();

  const [identity, sp] = await Promise.all([getPortalIdentity(), searchParams]);
  const admin = identity.tier === 'admin';
  const portal = identity.active;
  const unlocked = !def.keyGated || portal;

  // Seed the builder from the page's own query string: the same
  // where/cols/sort/limit/q/lens/day/since/source/company grammar the
  // download route accepts, so a shared /datasets/<slug>?... link
  // reproduces the builder exactly (query-url.ts's fromSearchParams is
  // tolerant of anything stale or malformed). Enum values are resolved here,
  // server side, so the client component never imports handoff-shared.
  const initialParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) { for (const v of value) initialParams.append(key, v); }
    else initialParams.append(key, value);
  }
  const initial = fromSearchParams(initialParams, def);

  // ?view=<uuid> (migration 0064): seed the builder from a saved view's own
  // spec. Never fetched for a guest (no active portal/admin identity), and
  // only handed to the client when it belongs to THIS dataset and is
  // readable by this identity (lib/portal/views-core.ts canReadView) - an
  // unknown or unreadable id is simply ignored, same as the download route's
  // own 404-not-403 posture (no existence oracle).
  const rawView = sp.view;
  const viewId = typeof rawView === 'string' ? rawView : Array.isArray(rawView) ? rawView[0] : undefined;
  let initialView: { id: string; name: string; spec: Record<string, string | string[]> } | null = null;
  if (viewId && UUID_RE.test(viewId) && (admin || portal)) {
    const view = await getView(viewId);
    if (view && view.dataset_slug === def.slug && canReadView(view, identity)) {
      initialView = { id: view.id, name: view.name, spec: view.spec };
    }
  }

  const queryColumns = def.columns.map((c) => ({
    key: c.key, label: c.label, type: c.type, def: c.def,
    values: c.type === 'enum' ? (c.values ?? fieldEnumValues(c.key) ?? null) : null,
  }));

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
            <>
              <Link className="btn btn--ghost btn--sm" href="/datasets/request">Request access</Link>
              <Link className="btn btn--primary btn--sm" href="/ask">
                Unlock with an access key
              </Link>
            </>
          )}
        >
          /api/datasets/{def.slug} · {def.columns.length} columns{def.keyGated ? ' · access key required' : ''}
        </PageTop>

        {def.keyGated && <RenewalNotice identity={identity} style={{ marginBottom: 20 }} />}

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
          <QueryBuilder
            slug={def.slug}
            columns={queryColumns}
            filters={def.filters}
            heavy={!!def.heavy}
            keyGated={!!def.keyGated}
            unlocked={unlocked}
            portal={portal}
            lensValues={[...SIGNAL_LENSES]}
            initial={initial}
            initialView={initialView}
          />
        </div>
      </section>
    </>
  );
}

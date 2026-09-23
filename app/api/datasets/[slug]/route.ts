import { after, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { logPortalUsage } from '@/lib/mutations/portal';
import { isSignalLens } from '@/lib/datasets/core';
import type { DatasetRow } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import { datasetFileName, datasetToCSV, datasetToJSON } from '@/lib/datasets/serialize';
import {
  applyFilterSpec, guardFilterRequest, isFilterRequested, isNarrowed, parseFilterSpec, projectColumns,
} from '@/lib/datasets/filter';
import { buildRowJsonSchema, envelopeJsonSchema } from '@/lib/datasets/handoff-shared';
import { getView } from '@/lib/data/portal-views';
import { touchView } from '@/lib/mutations/portal-views';
import { canReadView, mergeParams } from '@/lib/portal/views-core';

// The Datasets portal download route: /api/datasets/<slug>?format=csv|json[&lens=...].
// Public (allow-listed in proxy.ts; its matcher does not exempt /api/*), except
// key-gated datasets (bulk article text), which require a portal identity
// (lib/portal/identity.ts: admin, the legacy team-key cookie, or a per-person
// access key by cookie or Authorization/X-Atlas-Key header). Identified pulls
// are logged to portal_usage; anonymous public downloads are not.
// Bookkeeping runs inside next/server's after() so the insert outlives the
// flushed response, and only for an ACTIVE identity (a lapsed key pulling a
// public dataset is neither logged as a keyholder nor bumps last_used_at).
// Node runtime: builders run on lib/db's pg pool. No model call; maxDuration
// raised for the million-row intel-metrics export (measured ~10s locally, but
// prod pooler latency deserves headroom over the platform default).
//
// Filter grammar (lib/datasets/filter.ts, pure and DB-free): ?where=,
// ?cols=, ?sort=, ?limit=, ?q= narrow and reshape a builder's already-fetched
// rows in JS, validated against the dataset's own column list before any DB
// work runs. ?schema=1 returns the JSON Schema of the requested slice with no
// rows and no DB call. The existing ?lens/?day/?since/?source stay SQL
// pushdowns exactly as before; ?company=<slug> is the one new pushdown
// (declared per dataset via `filters.company`, today the three Intel Desk
// datasets only). ?view=<uuid> (migration 0064) loads a saved view's stored
// param record and lays this request's own params over it (see the block
// below); it never widens the gate above, since the merged params still run
// through the same parsing this route always ran.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Datasets change only when the admin publishes, so public downloads are safe to
// cache at the CDN for a few minutes. Key-gated responses are cookie-dependent
// and must never be cached shared.
const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The two CPU-safety guardrails around a JS-side filter/sort pass (the
// intel-metrics pushdown requirement, and the general row-count cap) live in
// guardFilterRequest (lib/datasets/filter.ts, pure and unit-tested); this
// route calls it once before def.build() and once after.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) {
    return Response.json({ error: 'Unknown dataset. See /api/datasets/catalog.' }, { status: 404 });
  }

  let sp = req.nextUrl.searchParams;
  const identity = await identityFromRequest(req);

  if (def.keyGated && !identity.active) {
    const denied = unauthorizedMessage(identity);
    if (sp.get('format') === 'csv') {
      return new Response(denied.body.message, {
        status: denied.status,
        headers: { ...denied.headers, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return Response.json(denied.body, { status: denied.status, headers: denied.headers });
  }

  // ?view=<uuid>: a saved view (migration 0064) lays its stored spec under
  // this request's own params (mergeParams: every param the caller passed
  // explicitly wins over the view's same-named one), so the rest of the
  // route reads one merged set of search params and never needs to know a
  // view was involved. The view must belong to THIS slug and be readable by
  // this identity (lib/portal/views-core.ts canReadView) or it 404s exactly
  // like an unknown dataset would, never a 403 (no existence oracle). This
  // can never widen the dataset: every param still runs through the same
  // parseFilterSpec/guardFilterRequest/keyGated gate below as a hand-typed
  // URL would.
  const viewId = sp.get('view');
  if (viewId !== null) {
    if (!UUID_RE.test(viewId)) {
      return Response.json({ error: 'Unknown view.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const view = await getView(viewId);
    if (!view || view.dataset_slug !== def.slug || !canReadView(view, identity)) {
      return Response.json({ error: 'Unknown view.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    // The view's `format` column (set on save, separate from its stored
    // param record) must win over an absent `format` in that record; layering
    // it under the spec here means an explicit ?format= on this request still
    // overrides both, exactly like every other view param.
    sp = mergeParams({ format: view.format, ...view.spec }, sp);
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
    after(() => Promise.all([
      touchView(view.id),
      logPortalUsage({
        keyId: identity.keyId,
        identity: identity.tier === 'admin' ? 'admin' : identity.tier === 'key' ? 'key' : 'legacy',
        kind: 'view_use',
        datasetSlug: def.slug,
        spec: { viewId: view.id },
        status: 200,
        ua,
      }),
    ]));
  }

  // The filter grammar is validated against this dataset's own columns
  // before any other query param, so a bad where/cols/sort/limit/q token
  // 400s before any DB work.
  const { spec: filterSpec, errors: filterErrors } = parseFilterSpec(def, sp);
  if (filterErrors.length) {
    return Response.json({ error: filterErrors[0] }, { status: 400 });
  }
  // Whether the grammar was used at all, for the response envelope and the
  // usage log; broader than isNarrowed (which excludes a sort-only request,
  // since sort alone never earns the '-filtered' filename suffix).
  const filterRequested = isFilterRequested(filterSpec);

  // ?preview=N: a limit-capable, JSON-only peek, for a quick in-browser look
  // at a heavy or key-gated dataset without pulling the whole corpus. Parsed
  // as a plain non-negative integer string; anything else (decimals, signs,
  // words) is a 400, not a silent fallback. In range it's clamped to 1..100
  // rather than rejected, so an over-eager caller still gets a capped preview.
  let previewLimit: number | undefined;
  const previewRaw = sp.get('preview');
  if (previewRaw !== null) {
    if (!/^\d+$/.test(previewRaw)) {
      return Response.json(
        { error: 'Bad preview. Use an integer between 1 and 100.' },
        { status: 400 }
      );
    }
    previewLimit = Math.min(100, Math.max(1, Number.parseInt(previewRaw, 10)));
  }
  const isPreview = previewLimit !== undefined;

  let format: 'csv' | 'json' = sp.get('format') === 'json' ? 'json' : 'csv';
  if (isPreview) format = 'json';
  let lens: string | undefined;
  if (def.filters?.lens) {
    const v = sp.get('lens');
    if (v) {
      if (!isSignalLens(v)) {
        return Response.json(
          { error: 'Unknown lens. Valid: market, labor, geopolitics, regulatory, capability, society.' },
          { status: 400 }
        );
      }
      lens = v;
    }
  }
  let day: string | undefined;
  if (def.filters?.day) {
    const v = sp.get('day');
    if (v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        return Response.json(
          { error: 'Bad day. Use YYYY-MM-DD; omit it for the latest completed day.' },
          { status: 400 }
        );
      }
      day = v;
    }
  }
  let since: string | undefined;
  if (def.filters?.since) {
    const v = sp.get('since');
    if (v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        return Response.json(
          { error: 'Bad since. Use YYYY-MM-DD; rows with fetched_at on or after that date are returned.' },
          { status: 400 }
        );
      }
      since = v;
    }
  }
  let source: string | undefined;
  if (def.filters?.source) {
    const v = sp.get('source');
    if (v) {
      if (!/^[a-z0-9_]{1,32}$/.test(v)) {
        return Response.json(
          { error: 'Bad source. Use one of the source codes listed on the dataset page.' },
          { status: 400 }
        );
      }
      source = v;
    }
  }
  // company: the one new pushdown, declared per dataset via filters.company
  // (today the three Intel Desk datasets). A dataset that does not declare
  // it 400s on a company= request rather than silently ignoring it, unlike
  // the four pushdowns above (whose param is simply unreachable when the
  // dataset opts out, since the whole block above is skipped).
  let company: string | undefined;
  const companyRaw = sp.get('company');
  if (companyRaw !== null) {
    if (!def.filters?.company) {
      return Response.json(
        { error: 'This dataset has no company filter.' },
        { status: 400 }
      );
    }
    if (!/^[a-z0-9-]{1,64}$/.test(companyRaw)) {
      return Response.json(
        { error: 'Bad company. Use a lowercase slug up to 64 characters.' },
        { status: 400 }
      );
    }
    company = companyRaw;
  }

  // A preview never writes the no-store full-download header, even key-gated:
  // it's a small, cheap peek, so it's safe to cache briefly per-viewer. Computed
  // here (it depends on nothing built) so the schema=1 short-circuit below can
  // share it. A ?view= response, though, can never be CDN-cached under
  // PUBLIC_CACHE even for a public dataset: whether it resolves depends on
  // the caller's identity (cookie/header), which the CDN does not key on, so
  // a cached 200 would serve a private view's slice to an anonymous request
  // that should 404, and skip the after() bookkeeping on every cache hit.
  const cache = viewId !== null
    ? 'private, no-store'
    : isPreview
    ? (def.keyGated ? 'private, max-age=60' : PUBLIC_CACHE)
    : (def.keyGated ? 'no-store' : PUBLIC_CACHE);

  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;

  // ?schema=1: the JSON Schema of exactly this slice (the projected columns),
  // plus the normalized filter spec. No rows, no DB call. Logged like any
  // other keyholder pull (kind 'schema' is part of logPortalUsage's union):
  // per-person usage accounting is the point of the key program, and a
  // schema pull is a real, billable-adjacent request even with no rows.
  if (sp.get('schema') === '1') {
    const projected = projectColumns(def, filterSpec);
    const projectedDef = { ...def, columns: projected };
    const rowSchema = buildRowJsonSchema(projectedDef);
    const envelope = envelopeJsonSchema(projectedDef, rowSchema);
    if (identity.active && identity.tier !== 'none') {
      const tier = identity.tier;
      after(() => Promise.all([
        logPortalUsage({
          keyId: identity.keyId,
          identity: tier,
          kind: 'schema',
          datasetSlug: def.slug,
          spec: { filter: filterRequested ? filterSpec : null },
          rows: 0,
          status: 200,
          ua,
        }),
        touchKey(identity.keyId),
      ]));
    }
    return Response.json(
      { schema: envelope, filter: filterRequested ? filterSpec : null },
      { headers: { 'Cache-Control': cache } }
    );
  }

  // Guardrail (before the fetch): intel-metrics runs to about two million
  // rows, so an unbounded JS-side filter/sort request never triggers the
  // full fetch (guardFilterRequest, lib/datasets/filter.ts).
  const preGuard = guardFilterRequest(def, filterSpec, { since, source, company, isPreview });
  if (preGuard) return Response.json({ error: preGuard.error }, { status: preGuard.status });

  // A preview carrying a where/q spec cannot use the cheap SQL LIMIT path:
  // the limit would apply BEFORE the filter runs, so the "preview" would show
  // the where/q match among the first previewLimit rows of the UNFILTERED
  // build (often zero) rather than a real preview of the filtered slice.
  // Such a preview fetches the full slice like a normal request instead (the
  // guard above already requires since/source/company to have narrowed it on
  // intel-metrics) and is capped to previewLimit AFTER filtering, below. A
  // preview with no where/q keeps the cheap SQL LIMIT path unchanged.
  const previewNeedsFullFetch = isPreview && (filterSpec.where.length > 0 || filterSpec.q !== null);
  const rows = await def.build(q, {
    lens, day, since, source, company, host: req.nextUrl.origin,
    limit: previewNeedsFullFetch ? undefined : previewLimit,
  });

  // Guardrail (after the fetch): any dataset whose built rows exceed the cap
  // refuses a narrowing request outright (the DB call has already happened
  // by this point; this is about capping the JS pass, not the fetch).
  const postGuard = guardFilterRequest(def, filterSpec, { since, source, company, isPreview, rowCount: rows.length });
  if (postGuard) return Response.json({ error: postGuard.error }, { status: postGuard.status });

  // The filename carries the day the download actually SERVED: when a
  // day-filtered dataset falls back to its latest-completed default, the rows
  // know the day (run_day) even though the request named none. The JSON
  // envelope's `day` stays the REQUESTED filter per the import contract.
  const servedDay =
    day ?? (def.filters?.day && typeof rows[0]?.run_day === 'string' ? rows[0].run_day : undefined);

  // where/q/sort/limit apply first, then the column projection; the CSV/JSON
  // header and every row both reflect the projected column set. A preview
  // that had to fetch the full slice (above) is capped to previewLimit here,
  // AFTER the filter, so the peek reflects the filtered match, not the
  // unfiltered build.
  const filteredAll = applyFilterSpec(def, rows, filterSpec);
  const filtered = previewNeedsFullFetch ? filteredAll.slice(0, previewLimit) : filteredAll;
  const projected = projectColumns(def, filterSpec);
  const narrowed = isNarrowed(filterSpec);
  const outRows: DatasetRow[] = filterSpec.cols
    ? filtered.map((r) => {
        const out: DatasetRow = {};
        for (const c of projected) out[c.key] = r[c.key] ?? null;
        return out;
      })
    : filtered;
  const filename = datasetFileName(def, format, lens, servedDay, since, narrowed);

  // Logged AFTER the filter/projection so rows counts what was actually
  // SERVED (outRows), not the pre-filter build: a keyholder pulling a dozen
  // filtered rows out of a much larger corpus must not be logged as if they
  // pulled the whole thing.
  if (identity.active && identity.tier !== 'none') {
    const tier = identity.tier;
    after(() => Promise.all([
      logPortalUsage({
        keyId: identity.keyId,
        identity: tier,
        kind: 'dataset',
        datasetSlug: def.slug,
        spec: {
          format, lens, day, since, source, company, preview: previewLimit ?? null,
          filter: filterRequested ? filterSpec : null,
        },
        rows: outRows.length,
        status: 200,
        ua,
      }),
      touchKey(identity.keyId),
    ]));
  }

  if (format === 'json') {
    // JSON is inline by default (quick in-browser inspection; the explorer
    // fetches it anyway); ?download=1 forces a saved file for the flows that
    // want one, like the /scan daily grab from a work browser. A preview is
    // always inline: it's a peek, never a file to save.
    const disposition = !isPreview && sp.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(
      datasetToJSON(def, outRows, {
        lens, day, since, source, preview: isPreview,
        columns: projected, filter: filterRequested ? filterSpec : null,
      }),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `${disposition}; filename="${filename}"`,
          'Cache-Control': cache,
        },
      }
    );
  }

  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    // attachment + a UTF-8 BOM so Excel opens the download cleanly.
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': cache,
  };

  // Heavy datasets (bulk article text) stream in row batches for memory hygiene;
  // everything else is a small single string. Both use the projected columns.
  if (def.heavy) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Header first (datasetToCSV of zero rows is exactly the header line),
        // then row batches with the per-batch header stripped.
        controller.enqueue(enc.encode('﻿' + datasetToCSV(def, [], { columns: projected })));
        const BATCH = 25;
        for (let i = 0; i < outRows.length; i += BATCH) {
          const part = datasetToCSV(def, outRows.slice(i, i + BATCH), { columns: projected });
          controller.enqueue(enc.encode(`\r\n${part.slice(part.indexOf('\r\n') + 2)}`));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers });
  }

  return new Response('﻿' + datasetToCSV(def, outRows, { columns: projected }), { headers });
}

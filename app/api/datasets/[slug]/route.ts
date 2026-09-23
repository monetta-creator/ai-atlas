import { after, type NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { logPortalUsage } from '@/lib/mutations/portal';
import { isSignalLens } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import { datasetFileName, datasetToCSV, datasetToJSON } from '@/lib/datasets/serialize';

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
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Datasets change only when the admin publishes, so public downloads are safe to
// cache at the CDN for a few minutes. Key-gated responses are cookie-dependent
// and must never be cached shared.
const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  const def = getDataset(slug);
  if (!def) {
    return Response.json({ error: 'Unknown dataset. See /api/datasets/catalog.' }, { status: 404 });
  }

  const sp = req.nextUrl.searchParams;
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

  const rows = await def.build(q, { lens, day, since, source, host: req.nextUrl.origin, limit: previewLimit });
  if (identity.active && identity.tier !== 'none') {
    const tier = identity.tier;
    const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
    after(() => Promise.all([
      logPortalUsage({
        keyId: identity.keyId,
        identity: tier,
        kind: 'dataset',
        datasetSlug: def.slug,
        spec: { format, lens, day, since, source, preview: previewLimit ?? null },
        rows: rows.length,
        status: 200,
        ua,
      }),
      touchKey(identity.keyId),
    ]));
  }
  // A preview never writes the no-store full-download header, even key-gated:
  // it's a small, cheap peek, so it's safe to cache briefly per-viewer.
  const cache = isPreview
    ? (def.keyGated ? 'private, max-age=60' : PUBLIC_CACHE)
    : (def.keyGated ? 'no-store' : PUBLIC_CACHE);
  // The filename carries the day the download actually SERVED: when a
  // day-filtered dataset falls back to its latest-completed default, the rows
  // know the day (run_day) even though the request named none. The JSON
  // envelope's `day` stays the REQUESTED filter per the import contract.
  const servedDay =
    day ?? (def.filters?.day && typeof rows[0]?.run_day === 'string' ? rows[0].run_day : undefined);
  const filename = datasetFileName(def, format, lens, servedDay, since);

  if (format === 'json') {
    // JSON is inline by default (quick in-browser inspection; the explorer
    // fetches it anyway); ?download=1 forces a saved file for the flows that
    // want one, like the /scan daily grab from a work browser. A preview is
    // always inline: it's a peek, never a file to save.
    const disposition = !isPreview && sp.get('download') === '1' ? 'attachment' : 'inline';
    return new Response(datasetToJSON(def, rows, { lens, day, since, source, preview: isPreview }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': cache,
      },
    });
  }

  const headers = {
    'Content-Type': 'text/csv; charset=utf-8',
    // attachment + a UTF-8 BOM so Excel opens the download cleanly.
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': cache,
  };

  // Heavy datasets (bulk article text) stream in row batches for memory hygiene;
  // everything else is a small single string.
  if (def.heavy) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Header first (datasetToCSV of zero rows is exactly the header line),
        // then row batches with the per-batch header stripped.
        controller.enqueue(enc.encode('\uFEFF' + datasetToCSV(def, [])));
        const BATCH = 25;
        for (let i = 0; i < rows.length; i += BATCH) {
          const part = datasetToCSV(def, rows.slice(i, i + BATCH));
          controller.enqueue(enc.encode(`\r\n${part.slice(part.indexOf('\r\n') + 2)}`));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers });
  }

  return new Response('\uFEFF' + datasetToCSV(def, rows), { headers });
}

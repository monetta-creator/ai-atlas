import type { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { isPortal } from '@/lib/auth';
import { isSignalContext } from '@/lib/datasets/core';
import { getDataset } from '@/lib/datasets/registry';
import { datasetFileName, datasetToCSV, datasetToJSON } from '@/lib/datasets/serialize';

// The Datasets portal download route: /api/datasets/<slug>?format=csv|json[&context=...].
// Public (allow-listed in proxy.ts; its matcher does not exempt /api/*), except
// key-gated datasets (bulk article text), which require the portal cookie.
// Node runtime: builders run on lib/db's pg pool. No model call.
export const dynamic = 'force-dynamic';

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

  if (def.keyGated && !(await isPortal())) {
    return new Response(
      'This dataset needs the team portal key. Unlock it at /datasets/ask, then retry the download.',
      { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }

  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'json' ? 'json' : 'csv';
  let context: string | undefined;
  if (def.filters?.context) {
    const v = sp.get('context');
    if (v) {
      if (!isSignalContext(v)) {
        return Response.json(
          { error: 'Unknown context. Valid: internal, external.' },
          { status: 400 }
        );
      }
      context = v;
    }
  }

  const rows = await def.build(q, { context });
  const cache = def.keyGated ? 'no-store' : PUBLIC_CACHE;
  const filename = datasetFileName(def, format, context);

  if (format === 'json') {
    return new Response(datasetToJSON(def, rows, { context }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `inline; filename="${filename}"`,
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

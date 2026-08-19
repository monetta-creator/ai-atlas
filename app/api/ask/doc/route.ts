import type { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { isAdmin, isPortal } from '@/lib/auth';

// The Ask workspace's document viewer: GET /api/ask/doc?signal=<uuid> returns
// the retained article text behind a signal so keyed readers can read the
// source beside the answer. Allow-listed in proxy.ts (the matcher does not
// exempt /api) but gated HERE: admin or portal-key holders only, never guests.
// The text is the internal working corpus (sources.raw_text from manual
// ingest, else the pipeline's cached page text) and is never public.
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const TEXT_CAP = 200_000;

interface DocRow {
  title: string;
  published_on: string | null;
  outlet: string | null;
  source_url: string | null;
  text: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!(await isPortal())) {
    return Response.json({ error: 'Locked.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const id = req.nextUrl.searchParams.get('signal') ?? '';
  if (!UUID_RE.test(id)) {
    return Response.json({ error: 'Unknown record.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const admin = await isAdmin();

  // Curated source text wins over the pipeline's cached page text; the lateral
  // picks the newest candidate deterministically (the articles-full-text idiom).
  // Draft signals resolve for admins only, matching the peek's row visibility.
  const rows = await q<DocRow>(
    `select s.title,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            coalesce(src.outlet, sc.source_domain) as outlet,
            coalesce(src.url, sc.url) as source_url,
            left(coalesce(src.raw_text, sc.raw_content), ${TEXT_CAP}) as text
       from signals s
       left join sources src on src.id = s.source_id
       left join lateral (
         select c.raw_content, c.url, c.source_domain from signal_candidates c
          where c.signal_id = s.id and c.raw_content is not null
          order by c.retrieved_at desc, c.id limit 1
       ) sc on true
      where s.id = $1 and (s.is_published or $2)`,
    [id, admin]
  );
  const r = rows[0];
  if (!r) {
    return Response.json({ error: 'Unknown record.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!r.text || r.text.trim().length === 0) {
    return Response.json(
      { error: 'No retained text for this record.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return Response.json(
    {
      title: r.title,
      published_on: r.published_on,
      outlet: r.outlet,
      source_url: r.source_url,
      chars: r.text.length,
      text: r.text,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

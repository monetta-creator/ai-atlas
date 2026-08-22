import type { NextRequest } from 'next/server';
import { createTicket } from '@/lib/mutations';

// The public ticket intake: POST multipart/form-data from the two feedback
// dialogs (bug report / feature request). Allow-listed in proxy.ts so a
// sessionless visitor can file one; every field is validated and capped here,
// which is the entire trust boundary. Images arrive already downscaled by the
// client (canvas, ~1600px JPEG) and are re-checked: count, size, and magic
// bytes, never just the declared content type.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SEVERITIES = new Set(['cosmetic', 'annoying', 'blocking']);

// Best-effort per-instance rate limit (serverless instances each get their own
// map; honeypot + caps are the real defense, this just blunts a tight loop).
const recent = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 5) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

function sniff(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const s = (v: FormDataEntryValue | null, cap: number): string =>
  (typeof v === 'string' ? v : '').trim().slice(0, cap);

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  // Honeypot: a visually hidden field real visitors never fill. A bot that
  // does gets a cheerful 200 and nothing stored.
  if (s(form.get('website'), 200)) return Response.json({ ok: true });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allow(ip)) return Response.json({ error: 'Too many tickets from here just now. Try again in a few minutes.' }, { status: 429 });

  const kind = s(form.get('kind'), 10);
  if (kind !== 'bug' && kind !== 'feature') return Response.json({ error: 'Bad request.' }, { status: 400 });
  const title = s(form.get('title'), 120);
  const body = s(form.get('body'), 5000);
  const email = s(form.get('email'), 200);
  const severityRaw = s(form.get('severity'), 20);
  const page = s(form.get('page'), 200);

  if (!title) return Response.json({ error: 'Give it a short name.' }, { status: 400 });
  if (!body) return Response.json({ error: 'The description is the whole point.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'That email does not look right.' }, { status: 400 });
  const severity = kind === 'bug' && SEVERITIES.has(severityRaw) ? severityRaw : null;

  const images: { contentType: string; bytes: Buffer }[] = [];
  for (const entry of form.getAll('images')) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (images.length >= MAX_IMAGES) break;
    if (entry.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: 'An image is too large (2MB max after compression).' }, { status: 400 });
    }
    const bytes = Buffer.from(await entry.arrayBuffer());
    const contentType = sniff(bytes);
    if (!contentType) return Response.json({ error: 'Images must be JPEG, PNG, or WebP.' }, { status: 400 });
    images.push({ contentType, bytes });
  }

  const id = await createTicket({
    kind,
    title,
    body,
    email,
    severity,
    page: page.startsWith('/') ? page : null,
    userAgent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
    images,
  });

  return Response.json({ ok: true, id });
}

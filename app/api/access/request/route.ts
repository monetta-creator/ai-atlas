import type { NextRequest } from 'next/server';
import { createAccessRequest } from '@/lib/mutations/portal';
import { getAgentPrefs } from '@/lib/data';
import { hashIp } from '@/lib/portal/identity';
import { EMAIL_RE, emailAllowed, parseDomainList } from '@/lib/portal/keys';
import { accessRequestSubject, renderAccessRequestHtml } from '@/lib/portal/email';
import { sendEmail } from '@/lib/email/resend';

// The public "Request an access key" intake (migration 0060): POST JSON or
// form data from /datasets/request. Allow-listed in proxy.ts so a sessionless
// visitor can file one; every field is validated and capped here, which is
// the entire trust boundary (mirrors app/api/tickets/route.ts). The request
// is stored first; the maintainer's email notice is best-effort and its
// failure never loses the request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Best-effort per-instance rate limit (serverless instances each get their own
// map; honeypot + caps + the domain allow-list are the real defense).
const recent = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (hits.length >= 3) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

// Trim, cap, and strip control characters (CR/LF included): the name goes
// into the notice email's subject line, where a newline gets the send rejected.
const s = (v: unknown, cap: number): string =>
  (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, cap);

async function readFields(req: NextRequest): Promise<Record<string, unknown> | null> {
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = await req.json();
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    }
    const form = await req.formData();
    return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return null;
  }
}

// Who gets the notice: PORTAL_NOTIFY_TO, else the agent brief's address (env,
// then the agent_prefs row). None set = the request is stored, no email.
async function notifyAddress(): Promise<string | null> {
  const env = (process.env.PORTAL_NOTIFY_TO || process.env.AGENT_EMAIL_TO || '').trim();
  if (env) return env;
  try {
    const prefs = await getAgentPrefs();
    return prefs.email_to?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const fields = await readFields(req);
  if (!fields) return Response.json({ error: 'Bad request.' }, { status: 400 });

  // Honeypot: a visually hidden field real visitors never fill. A bot that
  // does gets a cheerful 200 and nothing stored.
  if (s(fields.website, 200)) return Response.json({ ok: true, emailed: false });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allow(ip)) {
    return Response.json({ error: 'Too many requests from here just now. Try again in a few minutes.' }, { status: 429 });
  }

  const name = s(fields.name, 120);
  const email = s(fields.email, 200).toLowerCase();
  const reason = s(fields.reason, 1000);

  if (!name) return Response.json({ error: 'Tell us who you are.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return Response.json({ error: 'That email does not look right.' }, { status: 400 });
  // Fail closed: with no approved domains configured the form is not open
  // (the page renders a notice instead of the form; see requestsOpen()).
  const domains = parseDomainList(process.env.PORTAL_REQUEST_EMAIL_DOMAINS);
  if (!domains.length) return Response.json({ error: 'Requests are not open yet.' }, { status: 503 });
  if (!emailAllowed(email, domains)) {
    return Response.json({ error: 'Requests are limited to work addresses on the approved domains.' }, { status: 400 });
  }

  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  const id = await createAccessRequest({ name, email, reason: reason || null, userAgent, ipHash: hashIp(ip) });

  let emailed = false;
  const to = await notifyAddress();
  if (to) {
    const base = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, '');
    const result = await sendEmail({
      to,
      subject: accessRequestSubject(name),
      html: renderAccessRequestHtml({ name, email, reason, userAgent, consoleUrl: `${base}/access` }),
    });
    emailed = result.ok;
  }

  return Response.json({ ok: true, id, emailed });
}

// Webless text + URL utilities, re-homed from the retired lib/pipeline/web.ts
// (the web-discovery leg removed in the Strategy Atlas transition). Everything
// here operates on strings/bytes already in hand — nothing fetches.

export interface RawCandidate {
  url: string;
  headline: string;
  source_domain: string;
  published_date: string; // as provided; may be '' or imprecise
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Canonical form for dedup: host (no www) + path (no trailing slash) + sorted query, with
// tracking params and the fragment dropped, and the scheme ignored. Best-effort — returns the
// input lower-cased if it doesn't parse. Lets a re-added URL match one already tracked
// even when it differs only by http/https, www, a trailing slash, or utm_*/fbclid noise.
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const params = new URLSearchParams();
    [...u.searchParams.entries()]
      .filter(([k]) => !/^utm_/i.test(k) && !/^(fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => params.append(k, v));
    const path = u.pathname.replace(/\/+$/, '');
    const qs = params.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

// A classified ingest failure (kept as an error type: extraction can still fail
// terminally, e.g. an unparseable PDF, even with no fetching involved).
export class FetchFailure extends Error {
  readonly terminal: boolean;
  readonly canFallback: boolean;
  constructor(message: string, terminal: boolean, canFallback = true) {
    super(message);
    this.name = 'FetchFailure';
    this.terminal = terminal;
    this.canFallback = canFallback;
  }
}

// Postgres `text` cannot store NUL (the run-killing `invalid byte sequence for encoding
// "UTF8": 0x00` — binary bytes decoded as text), and pg chokes on lone surrogates. Strip
// both, plus the other C0 control chars (keeping \t \n \r), before anything DB-bound.
export function sanitizeText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\p{Surrogate}/gu, '');
}

// Minimum chars of readable text worth sending to the model — below this it's a stub
// or an empty shell of a document.
export const MIN_READABLE_CHARS = 200;

// %PDF- magic. Content-type alone is unreliable — files arrive as octet-stream.
export function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#3[49];|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bytes already in hand -> readable text (HTML or PDF). PDFs go through unpdf
// (serverless pdf.js — same library the add-source form uses in-browser);
// everything else is decoded with the declared charset and run through the crude
// HTML->text pass. Always sanitized. This is the server half of document intake.
export async function extractReadable(bytes: Uint8Array, contentType: string, maxChars: number): Promise<string> {
  if (looksLikePdf(bytes, contentType)) {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return sanitizeText(text).replace(/\s+/g, ' ').trim().slice(0, maxChars);
    } catch (e) {
      // The same bytes will fail the same way — terminal.
      const msg = e instanceof Error ? e.message : 'unknown error';
      throw new FetchFailure(`pdf text extraction failed: ${msg}`, true);
    }
  }
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder();
  }
  return htmlToText(sanitizeText(decoder.decode(bytes))).slice(0, maxChars);
}

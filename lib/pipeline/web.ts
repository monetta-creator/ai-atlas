import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { SIGNAL_LENS_SLUGS } from '../format';
import type { SignalLens } from '../types';

// The ONE web-enabled code path in the app. runStructured (lib/dossier.ts) is and
// stays non-web (single forced tool) to fit the 60s cap; this is deliberately separate.
// Uses the GA web_search tool (web_search_20250305) on the standard messages.create
// endpoint — no beta header needed (spike-confirmed). A single create() call: the
// server-side web_search tool runs the searches inside the request, then the model
// calls the submit_candidates client tool, which we parse. Spike-measured: ~3 searches
// ≈ 46s, so callers batch queries (<=3) to stay under the Hobby 60s cap.

const MODEL = 'claude-sonnet-4-6';

export interface RawCandidate {
  url: string;
  headline: string;
  source_domain: string;
  published_date: string; // as returned by the model; may be '' or imprecise
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// arXiv IDs encode the submission month (2505.18893 → 2025-05). The search model often
// returns '' for PDF dates, and without one triage can't enforce the recency window —
// which is how year-old papers sailed into a 7-day run. First-of-month is precise
// enough for window enforcement; a model-provided full date always wins.
function inferPublishedDate(url: string, modelDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(modelDate)) return modelDate;
  const m = /arxiv\.org\/(?:abs|pdf|html)\/(\d{2})(\d{2})\./i.exec(url);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `20${m[1]}-${m[2]}-01`;
  return modelDate;
}

// Canonical form for dedup: host (no www) + path (no trailing slash) + sorted query, with
// tracking params and the fragment dropped, and the scheme ignored. Best-effort — returns the
// input lower-cased if it doesn't parse. Lets a re-discovered URL match one already tracked
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

// Discovery primitive: run a small batch of web searches for one lens and return
// EVERYTHING found, unfiltered (triage does the filtering). Returns [] if the model
// answers without calling the tool.
export async function searchCandidates(opts: {
  lens: SignalLens;
  queries: string[];
  sinceISO: string; // e.g. '2026-05-27'
  maxUses?: number;
  pipelineRunId?: string; // cost-log provenance (the discovery run this batch belongs to)
  blockedDomains?: string[]; // deny-list + learned zero-yield domains — filtered at the search, not after
}): Promise<RawCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for discovery.');
  if (!opts.queries.length) return [];
  // Bound the call under the Hobby 60s cap: abort at 50s and DISABLE SDK retries
  // (maxRetries:0). A web-search call is long (~30-50s), so even one in-call SDK retry
  // would run past 60s and die as a platform 504 (the opaque "unexpected response"). With
  // retries off, a slow/overloaded call throws cleanly at 50s — under the cap — and the
  // orchestrator retries the whole batch on a fresh invocation (PipelineConsole).
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.maxUses ?? 3,
      // Server-side filtering: known PR-wire/SEO-farm domains (plus domains the funnel
      // has learned never yield) never even appear in results — cheaper than rejecting
      // them at triage, and the search returns useful items in their place.
      ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
    },
    {
      name: 'submit_candidates',
      description: 'Return every candidate item found, with no filtering or evaluation.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string' },
                headline: { type: 'string' },
                source_domain: { type: 'string' },
                published_date: { type: 'string' },
              },
              required: ['url', 'headline', 'source_domain', 'published_date'],
            },
          },
        },
        required: ['candidates'],
      },
    },
  ];

  const user = `Find candidate news items for the "${opts.lens}" lens published since ${opts.sinceISO}.
Run these web searches (one at a time):
${opts.queries.map((q) => `- ${q}`).join('\n')}

CRITICAL: Do NOT evaluate significance or quality. Do NOT summarize. Do NOT filter based on your judgment of what matters. Your only job is to return a structured list of items that plausibly match the lens. Prefer primary sources and serious analysis over aggregators and listicles, but when unsure, INCLUDE it — the next step filters. After searching, you MUST call submit_candidates with every item found (url, headline, source_domain, published_date; use '' for an unknown date).`;

  const params = {
    model: MODEL,
    max_tokens: 4000,
    tools,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  };
  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  // Web-search calls bill server-tool requests on top of tokens; we log the token-based cost
  // (the rate card is token pricing) and stash the web_search_requests count in metadata.
  await recordApiCall({
    feature: 'pipeline_discovery',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    pipelineRunId: opts.pipelineRunId,
    metadata: { lens: opts.lens },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_candidates'
  );
  if (!tu) return [];
  const out = tu.input as { candidates?: RawCandidate[] };
  return (out.candidates ?? [])
    .filter((c) => c && typeof c.url === 'string' && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      url: c.url.trim(),
      headline: String(c.headline ?? '').trim(),
      source_domain: String(c.source_domain ?? '').trim() || domainOf(c.url),
      published_date: inferPublishedDate(c.url.trim(), String(c.published_date ?? '').trim()),
    }));
}

interface SweepCandidate extends RawCandidate {
  lens: SignalLens;
}

// The breaking-events sweep call: like searchCandidates but lens-agnostic and
// significance-FIRST (the lens batches are told not to judge; this one exists to catch
// the week's headline events), restricted to a quality-outlet allowlist, and the model
// assigns each development the single lens it best fits. Same 50s/no-retry envelope.
export async function searchBreakingSweep(opts: {
  queries: string[];
  sinceISO: string;
  allowedDomains: string[];
  maxUses?: number;
  pipelineRunId?: string;
}): Promise<SweepCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for discovery.');
  if (!opts.queries.length) return [];
  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.maxUses ?? 2,
      // allowed_domains (not blocked_domains — the API takes one or the other): this
      // sweep only wants what serious outlets reported.
      ...(opts.allowedDomains?.length ? { allowed_domains: opts.allowedDomains } : {}),
    },
    {
      name: 'submit_developments',
      description: 'Return every distinct significant AI development found.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          developments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string' },
                headline: { type: 'string' },
                source_domain: { type: 'string' },
                published_date: { type: 'string' },
                lens: { type: 'string', enum: SIGNAL_LENS_SLUGS },
              },
              required: ['url', 'headline', 'source_domain', 'published_date', 'lens'],
            },
          },
        },
        required: ['developments'],
      },
    },
  ];

  const user = `You are running a breaking-news sweep for an AI-economy intelligence board. Find the MOST SIGNIFICANT AI developments published since ${opts.sinceISO}: frontier or open-weight model releases and major capability jumps, major AI lab or government announcements, major regulatory or export-control actions, and major AI market or infrastructure events.
Run these web searches (one at a time):
${opts.queries.map((q) => `- ${q}`).join('\n')}

Then call submit_developments with every distinct significant development found. For each give the single most authoritative URL you saw (prefer the primary source or the strongest outlet), the headline, source_domain, published_date ('' if unknown), and the one lens it best fits: market (money and valuations), labor (jobs and productivity), geopolitics (national competition and supply chains), regulatory (rules and enforcement), capability (what models can do), society (public attitudes and culture). When unsure whether something is significant enough, include it; the next step filters. Never use an em dash in any text you return.`;

  const params = {
    model: MODEL,
    max_tokens: 4000,
    tools,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  };
  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  await recordApiCall({
    feature: 'pipeline_discovery',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    pipelineRunId: opts.pipelineRunId,
    metadata: { sweep: true },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_developments'
  );
  if (!tu) return [];
  const out = tu.input as { developments?: (RawCandidate & { lens?: string })[] };
  return (out.developments ?? [])
    .filter((c) => c && typeof c.url === 'string' && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      url: c.url.trim(),
      headline: String(c.headline ?? '').trim(),
      source_domain: String(c.source_domain ?? '').trim() || domainOf(c.url),
      published_date: inferPublishedDate(c.url.trim(), String(c.published_date ?? '').trim()),
      lens: (SIGNAL_LENS_SLUGS as string[]).includes(String(c.lens))
        ? (c.lens as SignalLens)
        : 'capability',
    }));
}

// Reject URLs that aren't plain http(s) to a public host. Defense-in-depth against
// SSRF: the candidate URLs come from web-search results (public news) and the trigger
// is admin-only, but we still refuse loopback / private / link-local / metadata hosts.
// Exported for the scan's feed fetcher (lib/scan/feeds.ts), which shares the guard.
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http url');
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || // link-local incl. cloud metadata 169.254.169.254
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('blocked host');
  }
  return u;
}

// A classified fetch failure. `terminal` = retrying the same URL will fail the same way
// (4xx, bad URL, oversized/binary document) — the orchestrator flags the candidate
// immediately instead of burning retry attempts on a deterministic outcome.
// `canFallback` = the Jina reader could plausibly succeed where the direct fetch failed
// (bot-walls, paywalled stubs, unparseable PDFs — yes; dead/invalid/blocked URLs — no).
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

// Minimum chars of readable text worth sending to the model — below this it's a paywall
// stub, a cookie wall, or an empty shell page.
export const MIN_READABLE_CHARS = 200;

// HTTP statuses a retry of the SAME request cannot fix. 429/5xx/timeouts stay transient.
const TERMINAL_HTTP = new Set([400, 401, 402, 403, 404, 405, 406, 410, 451]);

// Statuses that mean the URL itself is wrong or dead — the reader fallback can't help.
// (401/403/451 are access walls; a different fetcher often gets through those.)
const NO_FALLBACK_HTTP = new Set([400, 404, 405, 410]);

// Download ceiling — anything bigger is not an analyzable article (and would blow the
// serverless memory budget). Checked against content-length and the actual body.
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AIAtlasBot/1.0; +https://ai-atlas)',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// %PDF- magic. Content-type alone is unreliable — CDNs serve PDFs as octet-stream.
function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

// Bytes -> readable text. PDFs go through unpdf (serverless pdf.js — same library the
// add-source form uses in-browser); everything else is decoded with the declared charset
// and run through the crude HTML->text pass. Always sanitized (see sanitizeText).
async function extractReadable(bytes: Uint8Array, contentType: string, maxChars: number): Promise<string> {
  if (looksLikePdf(bytes, contentType)) {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      return sanitizeText(text).replace(/\s+/g, ' ').trim().slice(0, maxChars);
    } catch (e) {
      // The same bytes will fail the same way — terminal for the direct path.
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

// Plain server fetch -> readable text (HTML or PDF). Throws FetchFailure, classified
// terminal/transient, so the caller can decide between flagging and retrying. The default
// 20s budget assumes the caller runs in its own invocation (hydrate); the analysis-time
// backstop passes a tighter one.
async function fetchReadableText(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number } = {}
): Promise<string> {
  const maxChars = opts.maxChars ?? 24000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  try {
    assertPublicHttpUrl(url);
  } catch (e) {
    throw new FetchFailure(e instanceof Error ? e.message : 'invalid url', true);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS, redirect: 'follow' });
    if (!res.ok) {
      throw new FetchFailure(
        `HTTP ${res.status}`,
        TERMINAL_HTTP.has(res.status),
        !NO_FALLBACK_HTTP.has(res.status)
      );
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_DOWNLOAD_BYTES) {
      throw new FetchFailure(`document too large (${Math.round(declared / 1e6)}MB)`, true);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof FetchFailure) throw e;
    const aborted = (e as Error)?.name === 'AbortError' || /abort/i.test(String((e as Error)?.message ?? ''));
    throw new FetchFailure(
      aborted
        ? `fetch timed out (${Math.round(timeoutMs / 1000)}s)`
        : `fetch failed: ${(e as Error)?.message ?? 'network error'}`,
      false
    );
  } finally {
    clearTimeout(timer);
  }
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new FetchFailure('document too large', true);
  return extractReadable(bytes, res.headers.get('content-type') ?? '', maxChars);
}

interface FetchedText {
  text: string;
  via: 'direct' | 'jina';
}

// Fallback reader for bot-walled / paywalled / unparseable URLs: r.jina.ai renders the
// page (PDFs included) and returns plain text — the WAF fingerprinting that 403s a
// direct server fetch (run e90257c4: weforum, congress.gov, sciencedirect…) doesn't
// apply to it. Keyless use is per-IP rate-limited; JINA_API_KEY (optional) lifts that.
// Only ever called with already-SSRF-checked public URLs.
async function fetchViaJina(url: string, maxChars: number, timeoutMs = 25_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'text/plain', 'X-Return-Format': 'markdown' };
    const key = process.env.JINA_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers });
    if (!res.ok) {
      // 429/5xx are the reader having a moment (retryable); other 4xx mean it cannot
      // process this URL at all. Nothing further to fall back to either way.
      throw new FetchFailure(
        `reader HTTP ${res.status}`,
        !(res.status === 429 || res.status >= 500),
        false
      );
    }
    const text = sanitizeText(await res.text()).replace(/\s+/g, ' ').trim();
    // The reader reports an upstream block as a 200 wrapping a stub ("Title: Just a
    // moment… Warning: Target URL returned error 403"). Tested live on congress.gov —
    // without this check the stub sails past the min-length gate into the model.
    const blocked = /Warning: Target URL returned error (\d+)/.exec(text.slice(0, 600));
    if (blocked) throw new FetchFailure(`reader: target returned ${blocked[1]}`, true, false);
    return text.slice(0, maxChars);
  } catch (e) {
    if (e instanceof FetchFailure) throw e;
    const aborted = (e as Error)?.name === 'AbortError' || /abort/i.test(String((e as Error)?.message ?? ''));
    throw new FetchFailure(
      aborted ? 'reader timed out' : `reader failed: ${(e as Error)?.message ?? 'network error'}`,
      false,
      false
    );
  } finally {
    clearTimeout(timer);
  }
}

// The single entry point candidates are fetched through (hydrate + the analysis backstop):
// direct fetch first, then — when the failure is one a different fetcher could beat —
// the Jina reader. `preferJina` (set when the domain's history says a direct fetch is
// doomed) reverses the order, with the direct path kept as insurance. `allowFallback:false`
// keeps the analysis-time backstop inside its invocation budget (the orchestrator's
// hydrate path has the full one).
export async function fetchCandidateText(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number; allowFallback?: boolean; preferJina?: boolean } = {}
): Promise<FetchedText> {
  const maxChars = opts.maxChars ?? 24000;
  const allowFallback = opts.allowFallback ?? true;
  // SSRF guard up front: it must cover BOTH paths (the reader would otherwise happily
  // fetch an internal URL on our behalf).
  try {
    assertPublicHttpUrl(url);
  } catch (e) {
    throw new FetchFailure(e instanceof Error ? e.message : 'invalid url', true, false);
  }

  const tryDirect = async (): Promise<FetchedText | FetchFailure> => {
    try {
      const text = await fetchReadableText(url, { maxChars, timeoutMs: opts.timeoutMs });
      if (text.length >= MIN_READABLE_CHARS) return { text, via: 'direct' };
      // A 200 with no body text is a paywall/cookie/JS stub — exactly what the reader beats.
      return new FetchFailure('page returned too little readable text to analyze', true);
    } catch (e) {
      return e instanceof FetchFailure
        ? e
        : new FetchFailure(e instanceof Error ? e.message : 'fetch failed', false);
    }
  };
  const tryJina = async (): Promise<FetchedText | FetchFailure> => {
    try {
      const text = await fetchViaJina(url, maxChars);
      if (text.length >= MIN_READABLE_CHARS) return { text, via: 'jina' };
      return new FetchFailure('reader returned too little readable text', true, false);
    } catch (e) {
      return e instanceof FetchFailure
        ? e
        : new FetchFailure(e instanceof Error ? e.message : 'reader failed', false, false);
    }
  };

  if (opts.preferJina && allowFallback) {
    const reader = await tryJina();
    if (!(reader instanceof FetchFailure)) return reader;
    const direct = await tryDirect(); // history can be wrong — direct stays as insurance
    if (!(direct instanceof FetchFailure)) return direct;
    throw direct; // the direct error (HTTP NNN) is the more diagnostic of the two
  }

  const direct = await tryDirect();
  if (!(direct instanceof FetchFailure)) return direct;
  if (!allowFallback || !direct.canFallback) throw direct;
  const reader = await tryJina();
  if (!(reader instanceof FetchFailure)) return reader;
  // A transient reader failure (rate limit, timeout) behind a terminal direct failure
  // must surface as TRANSIENT, or the orchestrator would flag a candidate the next
  // attempt's fallback might fetch fine.
  if (direct.terminal && !reader.terminal) {
    throw new FetchFailure(`${direct.message} (${reader.message})`, false);
  }
  throw direct;
}

function htmlToText(html: string): string {
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

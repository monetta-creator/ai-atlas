import { assertPublicHttpUrl, sanitizeText } from '../pipeline/web';
import { parseFeedXml } from './core';
import type { FeedItem } from './core';

// The scan's free discovery leg: fetch one RSS/Atom press feed and parse it.
// Direct fetch only — the Jina reader returns markdown, not XML, so there is
// no fallback here. Throws on any failure; the run engine catches PER FEED and
// continues, so a dead feed can never kill the leg (and costs nothing to retry
// tomorrow: the whole leg is model-free).

const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AIAtlasBot/1.0; +https://ai-atlas)',
  Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
};

const MAX_FEED_BYTES = 2 * 1024 * 1024; // press feeds are tens of KB; 2MB is generous

export async function fetchFeed(
  url: string,
  opts: { timeoutMs?: number; maxItems?: number } = {}
): Promise<FeedItem[]> {
  assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: FEED_HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_FEED_BYTES) throw new Error('feed too large');
    const body = await res.text();
    if (body.length > MAX_FEED_BYTES) throw new Error('feed too large');
    return parseFeedXml(sanitizeText(body), opts.maxItems ?? 50);
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError' || /abort/i.test(String((e as Error)?.message ?? ''));
    throw new Error(aborted ? 'feed timed out' : (e as Error)?.message ?? 'feed fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

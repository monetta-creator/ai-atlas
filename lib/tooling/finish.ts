import { fetchCandidateText, assertPublicHttpUrl } from '../pipeline/web';
import { discoverFeedLinks } from './core';
import { appendProductRawContent, setProductFeed } from '../mutations/tooling';

// The finish leg: for a product newly cataloged this run, a best-effort
// same-host /pricing read (appended to raw_content for the profile page and
// any later re-enrichment) and one raw homepage GET to look for a
// changelog/RSS <link> tag. Both halves are best-effort and independent: a
// missing pricing page or an unreadable homepage never blocks the other, and
// feed_checked_at is ALWAYS stamped so the product leaves the engine's
// finish-step queue regardless of what either half found.

const MAX_HOMEPAGE_CHARS = 300 * 1024; // ~300 KB; the <head> the feed link lives in is tiny

export async function finishProduct(p: { id: string; url: string | null }): Promise<{ pricing: boolean; feed: string | null }> {
  let pricing = false;
  let feed: string | null = null;
  const now = new Date().toISOString();

  if (p.url) {
    try {
      const pricingUrl = new URL('/pricing', p.url).toString();
      const { text } = await fetchCandidateText(pricingUrl, { maxChars: 8000, timeoutMs: 8000, allowFallback: false });
      await appendProductRawContent(p.id, 'PRICING PAGE', text);
      pricing = true;
    } catch {
      // No /pricing page, or it isn't directly fetchable: most products have
      // neither, and this leg has no reader fallback to fall back to.
    }

    try {
      const homepageUrl = assertPublicHttpUrl(p.url).toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(homepageUrl, { signal: controller.signal, redirect: 'follow' });
        if (res.ok) {
          const declared = Number(res.headers.get('content-length') || 0);
          if (!declared || declared <= MAX_HOMEPAGE_CHARS * 4) {
            const html = (await res.text()).slice(0, MAX_HOMEPAGE_CHARS);
            feed = discoverFeedLinks(html, homepageUrl)[0] ?? null;
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // The homepage may be unreachable, slow, or block a bare GET: best-effort.
    }
  }

  await setProductFeed(p.id, feed, now);
  return { pricing, feed };
}

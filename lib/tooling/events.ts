import { fetchFeed } from '../scan/feeds';
import { withinWindow } from '../scan/core';
import { insertProductEvents, setProductFeed } from '../mutations/tooling';

// The feed-polling leg: one vendor changelog/RSS feed per cataloged product
// with a known feed_url, since last_seen. Model-free (fetchFeed is a plain
// XML parse), so a dead feed is a note, never a budget concern. Always
// stamps feed_checked_at, success or failure, so the product leaves the
// engine's events-step queue either way (the daily/weekly cadence is the
// retry).

export async function pollProductFeed(
  p: { id: string; feed_url: string; last_seen: string }
): Promise<{ added: number; skipped: number; note: string | null }> {
  const now = new Date().toISOString();
  try {
    const items = await fetchFeed(p.feed_url);
    const fresh = items.filter((it) => withinWindow(it.publishedISO, p.last_seen));
    const events = fresh.map((it) => ({
      kind: 'changelog' as const,
      title: it.title,
      url: it.url,
      date: it.publishedISO,
      note: 'From the vendor feed.',
    }));
    const { added, skipped } = await insertProductEvents(p.id, events, 'feed');
    await setProductFeed(p.id, p.feed_url, now);
    return { added, skipped, note: null };
  } catch (e) {
    await setProductFeed(p.id, p.feed_url, now);
    return { added: 0, skipped: 0, note: `feed failed (${p.feed_url}): ${String((e as Error)?.message ?? 'error')}` };
  }
}

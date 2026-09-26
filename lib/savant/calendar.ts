import { q } from '../db';
import { extractDatedItems } from './calendar-core';
import type { DatedItem } from './types';

// The week ahead, the data half: dates the corpus already holds. Scans the
// week's signals, scan items and intel items for future dates near a trigger
// word (deadline, comment period, earnings, effective, hearing...) and never
// invents one; the pure extractor is ./calendar-core.ts.

export async function upcomingFromCorpus(window: { from: string; to: string }, today: string, horizonDays = 30): Promise<DatedItem[]> {
  const [signals, scan, intel] = await Promise.all([
    q<{ id: string; title: string; summary: string | null; brief: string | null; url: string | null }>(
      `select s.id::text as id, s.title, s.summary, s.brief, src.url
         from signals s left join sources src on src.id = s.source_id
        where s.is_published and s.first_published_at >= $1::timestamptz and s.first_published_at < $2::timestamptz`,
      [window.from, window.to]
    ),
    q<{ id: string; headline: string | null; summary: string | null; url: string }>(
      `select id::text as id, headline, summary, url from scan_items
        where created_at >= $1::timestamptz and created_at < $2::timestamptz and coalesce(relevance, 0) >= 0.55`,
      [window.from, window.to]
    ),
    q<{ id: string; headline: string | null; summary: string | null; url: string }>(
      `select id::text as id, headline, summary, url from intel_items
        where created_at >= $1::timestamptz and created_at < $2::timestamptz and coalesce(significance, 0) >= 0.5`,
      [window.from, window.to]
    ),
  ]);
  const items = [
    ...signals.map((s) => ({ id: `signal:${s.id}`, title: s.title, text: [s.summary, s.brief].filter(Boolean).join(' '), url: s.url, href: `/signals/${s.id}` })),
    ...scan.map((s) => ({ id: `scan:${s.id}`, title: s.headline ?? s.url, text: s.summary, url: s.url, href: null })),
    ...intel.map((s) => ({ id: `intel:${s.id}`, title: s.headline ?? s.url, text: s.summary, url: s.url, href: null })),
  ];
  return extractDatedItems(items, today, { horizonDays }).slice(0, 12);
}

import { fetchArxivPage } from './arxiv';
import * as m from '../mutations';

// The pull step: page through arXiv's newest submissions (cs.AI / cs.LG / cs.CL)
// until the run's window (since_date) is exhausted. No AI cost — plain XML. The
// console drives ONE page per server action (its own 60s budget + arXiv politeness);
// upserts are idempotent on arxiv_id, so re-running a page is a no-op and a long gap
// between sessions never duplicates the library.

// Hard ceiling on how deep a single run pages (docs/research-section.md: ~3,000
// papers ≈ a full 14-day window across the three categories).
const MAX_PULL = 3000;

interface PullPageResult {
  scanned: number;    // entries examined on this page
  inserted: number;   // new papers added to the library
  done: boolean;      // the window is exhausted (or the ceiling hit)
  nextStart: number;
}

export async function pullPage(runId: string, start: number, sinceISO: string): Promise<PullPageResult> {
  // Reflect the live step; clear a prior transient failure so a resumed run heals.
  await m.updateResearchRun(runId, { step: 'pull', status: 'running', error: null });

  const page = await fetchArxivPage(start);
  const entries = page.entries;

  // arXiv occasionally returns an empty 200 page mid-pagination. Treating it as
  // "window exhausted" would silently truncate the pull — throw instead, so the
  // console's transient-retry loop re-requests the same offset.
  if (entries.length === 0 && start > 0 && start < page.totalResults) {
    throw new Error('arXiv returned an empty page mid-pagination');
  }

  // Sorted newest-first by submission. An entry's `updated` is >= whatever bubbled it
  // up the sort, so "every update on this page predates the window" is the robust stop
  // condition; `published` (the v1 date) decides what actually enters the library
  // (revisions of old papers surface in the stream but are not new research).
  const fresh = entries.filter((e) => e.published >= sinceISO);
  const inserted = fresh.length ? await m.upsertArxivPapers(runId, fresh) : 0;
  await m.bumpResearchPullCounts(runId, entries.length, inserted);

  const nextStart = start + entries.length;
  // The whole page predates the window -> nothing newer can follow in the sort.
  const pastWindow = entries.length > 0 && entries.every((e) => e.updated && e.updated < sinceISO);
  const done =
    entries.length === 0 || pastWindow || nextStart >= page.totalResults || nextStart >= MAX_PULL;

  return { scanned: entries.length, inserted, done, nextStart };
}

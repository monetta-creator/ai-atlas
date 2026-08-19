import { q } from '../db';
import * as m from '../mutations';

// Citation refresh (docs/research-section.md phase 4): the Semantic Scholar Graph
// batch endpoint, keyed by arXiv id, no API key, no AI cost. In-session only — a
// button, never a cron. This is the funnel's self-correction: tracked papers show
// their compounding, and rejects the field disagrees with surface as "rising".

const BATCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,authors.hIndex';
const BATCH_SIZE = 500;

export interface Pedigree {
  citations: number | null;
  // Highest h-index among the paper's authors — the day-zero quality PRIOR. null =
  // paper not in S2 yet; a low value can also mean S2 hasn't disambiguated the
  // authors of a very fresh paper (it fills in on later refreshes).
  hindex: number | null;
}

export async function fetchPedigreeBatch(arxivIds: string[], timeoutMs = 20_000): Promise<Pedigree[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BATCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: arxivIds.map((id) => `arXiv:${id}`) }),
    });
    if (res.status === 429) throw new Error('Semantic Scholar rate limit hit: try again in a few minutes.');
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);
    const rows = (await res.json()) as ({
      citationCount?: number | null;
      authors?: { hIndex?: number | null }[] | null;
    } | null)[];
    // The batch endpoint returns results in input order, null for unknown papers.
    return arxivIds.map((_, i) => {
      const row = rows[i];
      const c = row?.citationCount;
      const hs = (row?.authors ?? [])
        .map((a) => a?.hIndex)
        .filter((h): h is number => typeof h === 'number' && Number.isFinite(h));
      return {
        citations: typeof c === 'number' && Number.isFinite(c) ? c : null,
        hindex: row ? (hs.length ? Math.max(...hs) : null) : null,
      };
    });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new Error(aborted ? 'Semantic Scholar timed out' : (e as Error)?.message ?? 'citation fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

// Refresh everything worth watching: the personal layer (tracked/noted), the live
// review queue, and every recent paper INCLUDING rejects (that is the point — the
// self-correction needs the rejects' counts). ~3k papers = 6 batch POSTs, a few
// seconds, well inside one invocation.
export async function refreshCitations(): Promise<{ checked: number; updated: number }> {
  const papers = await q<{ id: string; arxiv_id: string }>(
    `select id, arxiv_id from papers
      where arxiv_id is not null
        and (review_status in ('tracked', 'noted')
             or triage_status = 'kept'
             or created_at > now() - interval '90 days')`
  );
  let updated = 0;
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const chunk = papers.slice(i, i + BATCH_SIZE);
    const pedigree = await fetchPedigreeBatch(chunk.map((p) => p.arxiv_id));
    const pairs = chunk
      .map((p, j) => ({ id: p.id, count: pedigree[j].citations, hindex: pedigree[j].hindex }))
      .filter((p) => p.count != null || p.hindex != null);
    if (pairs.length) {
      await m.bulkUpdatePedigree(pairs);
      updated += pairs.length;
    }
  }
  return { checked: papers.length, updated };
}

// arXiv Atom API client — the Research section's intake (docs/research-section.md).
// One HTTP call per invocation (the console drives pages one checkpointed server
// action at a time), which also satisfies arXiv's ~1 request / 3s politeness rule.
// No AI cost anywhere in this file: listing a day's submissions is plain XML.

export const ARXIV_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];
export const ARXIV_PAGE_SIZE = 100;

export interface ArxivEntry {
  arxiv_id: string;        // versionless, e.g. '2607.07708'
  version: number | null;  // from the id suffix, e.g. v1
  url: string;             // canonical abs URL (no version)
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  primary_category: string | null;
  comment: string | null;  // the venue-acceptance signal ("Accepted at NeurIPS 2026")
  published: string;       // YYYY-MM-DD (v1 submission date)
  updated: string;         // YYYY-MM-DD (latest version date)
}

export interface ArxivPage {
  entries: ArxivEntry[];
  totalResults: number;
}

// Modern arXiv id (2007+): YYMM.NNNNN with an optional version. Accepts bare ids and
// abs/pdf/html URLs. Old-style ids (cs/0112017) are pre-2007 and out of scope for a
// latest-research intake. Returns the versionless id, or null.
export function parseArxivRef(input: string): string | null {
  const s = input.trim();
  const m =
    /(?:arxiv\.org\/(?:abs|pdf|html)\/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i.exec(s) ||
    /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(s);
  return m ? m[1] : null;
}

export function arxivAbsUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${arxivId}`;
}

// Decode the handful of entities the Atom feed actually emits, then collapse the
// hard-wrapped whitespace arXiv puts in titles/abstracts.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textField(block: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function dateOnly(s: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function parseEntry(block: string): ArxivEntry | null {
  // <id>http://arxiv.org/abs/2607.07708v1</id>
  const idRaw = textField(block, 'id');
  const idMatch = /arxiv\.org\/abs\/(\d{4}\.\d{4,5})(?:v(\d+))?/i.exec(idRaw);
  if (!idMatch) return null;
  const arxiv_id = idMatch[1];
  const version = idMatch[2] ? Number(idMatch[2]) : null;

  const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
    .map((m) => decodeEntities(m[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const categories = [...block.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
  const primary = /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(block);
  const comment = /<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/.exec(block);

  return {
    arxiv_id,
    version,
    url: arxivAbsUrl(arxiv_id),
    title: textField(block, 'title'),
    abstract: textField(block, 'summary'),
    authors,
    categories: Array.from(new Set(categories)),
    primary_category: primary ? primary[1] : null,
    comment: comment ? decodeEntities(comment[1]).replace(/\s+/g, ' ').trim() : null,
    published: dateOnly(textField(block, 'published')),
    updated: dateOnly(textField(block, 'updated')),
  };
}

function parseFeed(xml: string): ArxivPage {
  const totalMatch = /<opensearch:totalResults[^>]*>(\d+)</.exec(xml);
  const totalResults = totalMatch ? Number(totalMatch[1]) : 0;
  const entries: ArxivEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = parseEntry(m[1]);
    if (e) entries.push(e);
  }
  return { entries, totalResults };
}

async function fetchFeed(qs: string, timeoutMs = 25_000): Promise<ArxivPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?${qs}`, {
      signal: controller.signal,
      // arXiv asks API clients to identify themselves with a contact address.
      headers: {
        'User-Agent': `AIAtlasResearch/1.0${process.env.RESEARCH_CONTACT_EMAIL ? ` (mailto:${process.env.RESEARCH_CONTACT_EMAIL})` : ''}`,
      },
    });
    if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`);
    return parseFeed(await res.text());
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new Error(aborted ? 'arXiv API timed out' : `arXiv API: ${(e as Error)?.message ?? 'fetch failed'}`);
  } finally {
    clearTimeout(timer);
  }
}

// One page of the newest submissions across the tracked categories, newest first.
// `start` is the arXiv result offset — the console pages through until the window
// (since_date) is exhausted.
export async function fetchArxivPage(start: number, pageSize = ARXIV_PAGE_SIZE): Promise<ArxivPage> {
  const search = ARXIV_CATEGORIES.map((c) => `cat:${c}`).join(' OR ');
  const qs = new URLSearchParams({
    search_query: search,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    start: String(start),
    max_results: String(pageSize),
  }).toString();
  return fetchFeed(qs);
}

// Metadata for specific ids (the manual "Add paper" path). id_list ignores search_query.
export async function fetchArxivByIds(ids: string[]): Promise<ArxivEntry[]> {
  if (!ids.length) return [];
  const qs = new URLSearchParams({
    id_list: ids.join(','),
    max_results: String(ids.length),
  }).toString();
  return (await fetchFeed(qs)).entries;
}

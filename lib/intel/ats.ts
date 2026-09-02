// LLM-free ATS hiring-signal unit: public no-auth Greenhouse/Lever job-board
// JSON per tracked company, reduced to open-role counts by keyword bucket.
// Pure fetch + count, no model call, no DB — the intel_metrics warehouse is
// the writer (lib/intel/engine.ts runAtsUnit), not this module.

export type AtsProvider = 'greenhouse' | 'lever';

export interface AtsConfig {
  provider: AtsProvider;
  board: string;
}

export interface AtsSnapshot {
  total: number;
  buckets: Record<string, number>;
}

const ATS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AIAtlasBot/1.0; +https://ai-atlas)',
  Accept: 'application/json',
};

const FETCH_TIMEOUT_MS = 10_000;

// Bucket rules: a title can land in several buckets. Short, ambiguous
// acronyms (AI, ML, SWE, AML) use \b word boundaries so they don't fire on
// substrings inside ordinary words ("Email", "Retail", "Small"); longer,
// unambiguous phrases match as a leading word so a plural/gerund suffix
// still counts ("engineer" matches "Engineering", "agent" matches "Agentic").
const BUCKET_RULES: { code: string; patterns: RegExp[] }[] = [
  {
    code: 'ai_ml',
    patterns: [/\bai\b/i, /\bmachine learning\b/i, /\bml\b/i, /\bllm\b/i, /\bdata scient/i],
  },
  {
    code: 'fraud_risk',
    patterns: [/\bfraud/i, /\brisk\b/i, /\baml\b/i, /\bcompliance/i],
  },
  {
    code: 'engineering',
    patterns: [/\bengineer/i, /\bdeveloper\b/i, /\bswe\b/i],
  },
  {
    code: 'agents',
    patterns: [/\bagent/i, /\bautomation/i],
  },
];

export const ATS_BUCKET_CODES: string[] = BUCKET_RULES.map((r) => r.code);

// Exported for the test script: pure title-list -> bucket-count reducer, no
// fetch involved.
export function countJobBuckets(titles: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rule of BUCKET_RULES) counts[rule.code] = 0;
  for (const title of titles) {
    for (const rule of BUCKET_RULES) {
      if (rule.patterns.some((re) => re.test(title))) counts[rule.code] += 1;
    }
  }
  return counts;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: ATS_HEADERS });
    if (!res.ok) throw new Error(`ATS HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new Error(aborted ? 'ATS fetch timed out' : (e as Error)?.message || 'ATS fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

interface GreenhouseJobsResponse {
  jobs?: { title?: string }[];
}

interface LeverPosting {
  text?: string;
}

export async function fetchAtsSnapshot(provider: AtsProvider, board: string): Promise<AtsSnapshot> {
  const token = encodeURIComponent(board);
  const titles: string[] =
    provider === 'greenhouse'
      ? (await fetchJson<GreenhouseJobsResponse>(
          `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`
        )).jobs?.map((j) => String(j.title ?? '')).filter(Boolean) ?? []
      : (await fetchJson<LeverPosting[]>(
          `https://api.lever.co/v0/postings/${token}?mode=json`
        )).map((p) => String(p.text ?? '')).filter(Boolean);
  return { total: titles.length, buckets: countJobBuckets(titles) };
}

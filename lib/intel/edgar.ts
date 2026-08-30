import { recordApiCall } from '../cost.ts';
import { EDGAR_FORMS } from './core.ts';

// The filings leg: SEC EDGAR's free JSON APIs, LLM-free. One submissions
// fetch per company surfaces new filings (8-K, 10-Q, 10-K, S-1, DEF 14A,
// 20-F, 6-K) as intel items whose primary document the hydrate leg then
// fetches like any other URL. EDGAR asks for a declared User-Agent with a
// contact address (RESEARCH_CONTACT_EMAIL, the arXiv convention) and allows
// 10 req/s; the engine does one company per unit, far below that.

const EDGAR_TIMEOUT_MS = 15_000;
const MAX_FILINGS_PER_SWEEP = 10;

export function edgarUA(): string {
  return `ai-atlas-intel ${process.env.RESEARCH_CONTACT_EMAIL || 'contact@example.com'}`;
}

export async function edgarJson<T>(url: string, timeoutMs = EDGAR_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': edgarUA(), Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface SubmissionsPayload {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

export interface EdgarFiling {
  url: string;
  headline: string;
  published_date: string;
  form: string;
}

function isTrackedForm(form: string): boolean {
  // Prefix match covers amendments (10-K/A, 8-K/A).
  return EDGAR_FORMS.some((f) => form === f || form.startsWith(`${f}/`));
}

// New filings for one company since the window start. The submissions payload
// is parallel arrays over the ~1000 most recent filings; a daily window
// touches only the first handful.
export async function fetchRecentFilings(
  cik: string,
  sinceISO: string,
  intelRunId?: string
): Promise<EdgarFiling[]> {
  const padded = cik.padStart(10, '0');
  const t0 = Date.now();
  const data = await edgarJson<SubmissionsPayload>(`https://data.sec.gov/submissions/CIK${padded}.json`);
  const r = data.filings?.recent;
  const out: EdgarFiling[] = [];
  const n = r?.form?.length ?? 0;
  for (let i = 0; i < n && out.length < MAX_FILINGS_PER_SWEEP; i++) {
    const form = r?.form?.[i] ?? '';
    const filingDate = r?.filingDate?.[i] ?? '';
    const accession = r?.accessionNumber?.[i] ?? '';
    const primaryDoc = r?.primaryDocument?.[i] ?? '';
    if (!isTrackedForm(form) || !filingDate || filingDate < sinceISO) continue;
    if (!accession || !primaryDoc) continue;
    const accNoDashes = accession.replace(/-/g, '');
    out.push({
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNoDashes}/${primaryDoc}`,
      headline: `${form}: ${r?.primaryDocDescription?.[i] || primaryDoc} (${filingDate})`,
      published_date: filingDate,
      form,
    });
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'edgar-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, cik, filings: out.length, provider: 'edgar' },
  });
  return out;
}

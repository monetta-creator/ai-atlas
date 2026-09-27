// Network fetchers for the reader organization's public record
// (scripts/history-backfill.mts, Part B; docs/self-record.md). Free public
// sources only, each called with the etiquette its operator asks for. Every
// query is built from the registry row the caller passes in; nothing here
// names the organization. No DB access: the script writes what these return.

import { edgarJson, edgarUA } from '../intel/edgar.ts';
import { htmlToText } from './core.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch(url, { headers: opts.headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---- SEC EDGAR ---------------------------------------------------------------------
// The submissions API returns the ~1000 most recent filings inline and older
// ones in paged files; a 2022-2026 window for a large filer can reach into
// the first page (425 merger communications are numerous).

export interface SecFiling {
  form: string;
  filingDate: string;
  accession: string;
  primaryDoc: string;
  description: string;
  items: string;
  url: string;
  indexUrl: string;
}

interface Columns {
  form?: string[]; filingDate?: string[]; accessionNumber?: string[];
  primaryDocument?: string[]; primaryDocDescription?: string[]; items?: string[];
}

export const SEC_FORMS = ['10-K', '10-Q', '8-K', 'DEF 14A', 'S-4', '425', 'ARS'];

function fromColumns(cik: string, c: Columns | undefined, since: string): SecFiling[] {
  const out: SecFiling[] = [];
  const n = c?.form?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const form = c?.form?.[i] ?? '';
    const date = c?.filingDate?.[i] ?? '';
    const acc = c?.accessionNumber?.[i] ?? '';
    const doc = c?.primaryDocument?.[i] ?? '';
    if (!date || date < since || !acc || !doc) continue;
    if (!SEC_FORMS.some((f) => form === f || form.startsWith(`${f}/`))) continue;
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}`;
    out.push({
      form, filingDate: date, accession: acc, primaryDoc: doc,
      description: c?.primaryDocDescription?.[i] ?? '', items: c?.items?.[i] ?? '',
      url: `${base}/${doc}`, indexUrl: `${base}/index.json`,
    });
  }
  return out;
}

export async function listSecFilings(cik: string, since: string): Promise<SecFiling[]> {
  const padded = cik.padStart(10, '0');
  const data = await edgarJson<{ filings?: { recent?: Columns; files?: { name: string; filingTo?: string }[] } }>(
    `https://data.sec.gov/submissions/CIK${padded}.json`);
  const out = fromColumns(cik, data.filings?.recent, since);
  for (const f of data.filings?.files ?? []) {
    if (f.filingTo && f.filingTo < since) continue;
    await sleep(150);
    const page = await edgarJson<Columns>(`https://data.sec.gov/submissions/${f.name}`);
    out.push(...fromColumns(cik, page, since));
  }
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.accession) ? false : (seen.add(f.accession), true)))
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate));
}

export async function fetchSecText(url: string): Promise<string> {
  const html = await fetchText(url, { headers: { 'User-Agent': edgarUA() }, timeoutMs: 40_000 });
  return htmlToText(html);
}

// An 8-K's press release rides as exhibit 99.x; the filing index lists it.
export async function findPressRelease(indexUrl: string): Promise<{ url: string; name: string } | null> {
  const idx = await edgarJson<{ directory?: { item?: { name: string; type?: string }[] } }>(indexUrl);
  const items = idx.directory?.item ?? [];
  const hit = items.find((it) => /ex-?99\.?1|ex99[_-]?1|dex991/i.test(it.name) && /\.html?$/i.test(it.name))
    ?? items.find((it) => /ex-?99|ex99|dex99/i.test(it.name) && /\.html?$/i.test(it.name));
  if (!hit) return null;
  return { url: indexUrl.replace(/index\.json$/, hit.name), name: hit.name };
}

// ---- OpenAlex ----------------------------------------------------------------------
// Research credited to the organization: resolve its institution id from the
// name, then list works since the window start. The polite pool asks for a
// mailto; no key needed.

function mailto(): string {
  return encodeURIComponent(process.env.RESEARCH_CONTACT_EMAIL || 'contact@example.com');
}

export interface OpenAlexWork {
  id: string;
  title: string;
  url: string;
  published: string | null;
  doi: string | null;
  venue: string | null;
  cited: number;
  abstract: string;
  concepts: string[];
  type: string | null;
}

export async function resolveInstitution(name: string): Promise<{ id: string; display: string; works: number } | null> {
  const r = JSON.parse(await fetchText(
    `https://api.openalex.org/institutions?search=${encodeURIComponent(name)}&per-page=10&mailto=${mailto()}`)) as {
      results?: { id: string; display_name: string; type?: string; country_code?: string; works_count?: number }[] };
  const list = r.results ?? [];
  const pick = list.find((i) => i.type === 'company' && i.country_code === 'US') ?? list.find((i) => i.type === 'company') ?? null;
  return pick ? { id: pick.id.replace('https://openalex.org/', ''), display: pick.display_name, works: pick.works_count ?? 0 } : null;
}

function rebuildAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return '';
  const slots: string[] = [];
  for (const [w, idxs] of Object.entries(inv)) for (const i of idxs) slots[i] = w;
  return slots.filter(Boolean).join(' ');
}

export async function listOpenAlexWorks(institutionId: string, since: string, max = 600): Promise<OpenAlexWork[]> {
  const out: OpenAlexWork[] = [];
  let cursor = '*';
  while (cursor && out.length < max) {
    const url = `https://api.openalex.org/works?filter=authorships.institutions.lineage:${institutionId},from_publication_date:${since}`
      + `&per-page=100&cursor=${encodeURIComponent(cursor)}&mailto=${mailto()}`;
    const r = JSON.parse(await fetchText(url)) as {
      meta?: { next_cursor?: string | null };
      results?: {
        id: string; display_name?: string; publication_date?: string; doi?: string | null; type?: string;
        cited_by_count?: number; abstract_inverted_index?: Record<string, number[]> | null;
        primary_location?: { landing_page_url?: string | null; source?: { display_name?: string } | null } | null;
        concepts?: { display_name: string; score: number }[]; topics?: { display_name: string }[];
      }[];
    };
    for (const w of r.results ?? []) {
      if (!w.display_name) continue;
      out.push({
        id: w.id, title: w.display_name,
        url: w.doi ?? w.primary_location?.landing_page_url ?? w.id,
        published: w.publication_date ?? null, doi: w.doi ?? null,
        venue: w.primary_location?.source?.display_name ?? null, cited: w.cited_by_count ?? 0,
        abstract: rebuildAbstract(w.abstract_inverted_index).slice(0, 3000),
        concepts: [...(w.topics ?? []).map((t) => t.display_name), ...(w.concepts ?? []).filter((c) => c.score > 0.3).map((c) => c.display_name)].slice(0, 8),
        type: w.type ?? null,
      });
    }
    cursor = r.meta?.next_cursor ?? '';
    if (!(r.results ?? []).length) break;
    await sleep(120);
  }
  return out;
}

// ---- USPTO Open Data Portal (patents) ------------------------------------------------
// PatentsView's PatentSearch API moved into the USPTO Open Data Portal on
// 2026-03-20 (search.patentsview.org no longer resolves) and its old keys do
// not work there. The ODP key lives in PATENTSVIEW_API_KEY (or USPTO_API_KEY).
// The patent file wrapper search takes a Lucene-style `q`, `fields`, `limit`
// (100 per page) and `offset`; it carries title, grant date, first applicant
// and CPC codes but no abstract. AI patents are flagged by CPC G06N (machine
// learning and computational models) or AI terms in the title.

export interface Patent {
  number: string;
  title: string;
  date: string;
  abstract: string;
  cpc: string[];
  applicant: string;
  url: string;
}

const ODP_SEARCH = 'https://api.uspto.gov/api/v1/patent/applications/search';

export function usptoKey(): string | undefined {
  return process.env.USPTO_API_KEY || process.env.PATENTSVIEW_API_KEY || undefined;
}

export async function listPatents(assignee: string, since: string, max = 6000): Promise<Patent[]> {
  const key = usptoKey();
  if (!key) throw new Error('PATENTSVIEW_API_KEY (a USPTO Open Data Portal key) is not set');
  const today = new Date().toISOString().slice(0, 10);
  const q = `applicationMetaData.firstApplicantName:"${assignee.replace(/"/g, '')}" AND applicationMetaData.grantDate:[${since} TO ${today}]`;
  const fields = ['applicationMetaData.patentNumber', 'applicationMetaData.grantDate', 'applicationMetaData.inventionTitle',
    'applicationMetaData.cpcClassificationBag', 'applicationMetaData.firstApplicantName'].join(',');
  const out: Patent[] = [];
  for (let offset = 0; offset < max; offset += 100) {
    const url = `${ODP_SEARCH}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { 'X-API-KEY': key, Accept: 'application/json' } });
    if (res.status === 404) break; // the ODP answers 404 past the last page
    if (!res.ok) throw new Error(`USPTO ODP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const r = (await res.json()) as {
      count?: number;
      patentFileWrapperDataBag?: { applicationMetaData?: { patentNumber?: string; grantDate?: string; inventionTitle?: string; cpcClassificationBag?: string[]; firstApplicantName?: string } }[];
    };
    const page = r.patentFileWrapperDataBag ?? [];
    for (const row of page) {
      const m = row.applicationMetaData;
      if (!m?.patentNumber || !m.grantDate) continue;
      out.push({
        number: m.patentNumber, title: (m.inventionTitle ?? '').trim(), date: m.grantDate, abstract: '',
        cpc: [...new Set((m.cpcClassificationBag ?? []).map((c) => c.replace(/\s+/g, ' ').trim()))],
        applicant: m.firstApplicantName ?? '',
        url: `https://patents.google.com/patent/US${m.patentNumber}`,
      });
    }
    if (page.length < 100 || (r.count != null && offset + 100 >= r.count)) break;
    await sleep(600);
  }
  return out;
}

// ---- regulations.gov + govinfo (api.data.gov key) ----------------------------------------

export interface RegDoc {
  id: string; title: string; date: string | null; url: string; agency: string | null; kind: string;
  docket?: string | null; docketTitle?: string | null; attachmentUrl?: string | null; organization?: string | null;
}

// Comment letters the ORGANIZATION filed. A search for its quoted name also
// returns hundreds of consumer comments that merely mention it (1,572 hits on
// 2026-09-27, mostly individuals on a merger docket), so only comments whose
// title starts with the name are kept (regulations.gov titles an organization's
// letter with the organization), then each one's detail supplies the docket and
// the attached letter.
export async function listCommentLetters(name: string, since: string): Promise<RegDoc[]> {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) throw new Error('DATA_GOV_API_KEY is not set');
  const own = (t: string) => t.toLowerCase().startsWith(name.toLowerCase());
  const hits: { id: string; title: string; date: string | null; agency: string | null }[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.regulations.gov/v4/comments?filter[searchTerm]=${encodeURIComponent(`"${name}"`)}`
      + `&filter[postedDate][ge]=${since}&page[size]=250&page[number]=${page}&api_key=${key}`;
    const r = JSON.parse(await fetchText(url)) as { data?: { id: string; attributes?: { title?: string; postedDate?: string; agencyId?: string } }[] };
    const data = r.data ?? [];
    for (const d of data) {
      const t = d.attributes?.title ?? '';
      if (own(t)) hits.push({ id: d.id, title: t, date: d.attributes?.postedDate?.slice(0, 10) ?? null, agency: d.attributes?.agencyId ?? null });
    }
    if (data.length < 250) break;
    await sleep(400);
  }
  const docketTitles = new Map<string, string | null>();
  const out: RegDoc[] = [];
  for (const h of hits) {
    await sleep(400);
    const d = JSON.parse(await fetchText(`https://api.regulations.gov/v4/comments/${h.id}?include=attachments&api_key=${key}`)) as {
      data?: { attributes?: { docketId?: string; organization?: string } };
      included?: { attributes?: { fileFormats?: { fileUrl?: string; format?: string }[] } }[];
    };
    const docket = d.data?.attributes?.docketId ?? null;
    if (docket && !docketTitles.has(docket)) {
      await sleep(400);
      try {
        const dk = JSON.parse(await fetchText(`https://api.regulations.gov/v4/dockets/${docket}?api_key=${key}`)) as { data?: { attributes?: { title?: string } } };
        docketTitles.set(docket, dk.data?.attributes?.title ?? null);
      } catch { docketTitles.set(docket, null); }
    }
    const files = (d.included ?? []).flatMap((x) => x.attributes?.fileFormats ?? []);
    const pdf = files.find((f) => /pdf/i.test(f.format ?? f.fileUrl ?? '')) ?? files[0];
    out.push({
      id: h.id, title: h.title, date: h.date, agency: h.agency, kind: 'comment_letter',
      url: `https://www.regulations.gov/comment/${h.id}`, docket, docketTitle: docket ? docketTitles.get(docket) ?? null : null,
      attachmentUrl: pdf?.fileUrl ?? null, organization: d.data?.attributes?.organization ?? null,
    });
  }
  return out;
}

// Congressional hearings (govinfo collection CHRG) that name the organization
// alongside AI: testimony and the record around it. Court opinions are left out
// on purpose (they are dominated by consumer suits that mention the name).
export async function listTestimony(name: string, since: string): Promise<RegDoc[]> {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) throw new Error('DATA_GOV_API_KEY is not set');
  const res = await fetch(`https://api.govinfo.gov/search?api_key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `collection:(CHRG) AND "${name}" AND ("artificial intelligence" OR "machine learning") AND publishdate:range(${since},)`,
      pageSize: 100, offsetMark: '*', sorts: [{ field: 'publishdate', sortOrder: 'DESC' }],
    }),
  });
  if (!res.ok) throw new Error(`govinfo ${res.status}`);
  const r = (await res.json()) as { results?: { packageId: string; title: string; dateIssued?: string; collectionCode?: string; pdfLink?: string; download?: { pdfLink?: string } }[] };
  return (r.results ?? []).map((x) => ({
    id: x.packageId, title: x.title, date: x.dateIssued ?? null, agency: x.collectionCode ?? null, kind: 'testimony',
    url: `https://www.govinfo.gov/app/details/${x.packageId}`,
    attachmentUrl: x.download?.pdfLink ? `${x.download.pdfLink}?api_key=${key}` : null,
  }));
}

export { fetchText };

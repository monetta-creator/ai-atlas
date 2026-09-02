import { recordApiCall } from '../cost.ts';
import { edgarJson } from './edgar.ts';
import type { IntelCompany, IntelMetricSource } from '../types';

// The LLM-free structured-metrics leg: quarterly series from three free
// public APIs, upserted idempotently on (company, metric, period, source).
// Runs weekly (the engine gates it to Monday runs): quarterly data does not
// move daily, and the re-fetch upsert absorbs restatements.
//
//   * EDGAR XBRL companyfacts: ONE multi-MB fetch per filer carrying every
//     reported concept. Not the smaller per-concept companyconcept endpoint:
//     that one returns empty units arrays for some filers whose companyfacts
//     are fully populated (live-verified 2026-08-30 on a large bank holding
//     company: empty via companyconcept, 138 Assets facts via companyfacts).
//     Concepts vary by filer, so each metric carries fallback concepts.
//   * FDIC BankFind financials: call-report-derived fields per FDIC cert.
//   * CFPB consumer complaints: trailing-30-day complaint count. The API
//     matches its own registered legal names (all-caps corporate form), so
//     the fetcher resolves a legal name first: the registry's cfpb_name
//     when set (empty string skips CFPB on purpose), else the
//     _suggest_company endpoint's first suggestion.

const FETCH_TIMEOUT_MS = 15_000;
const MAX_QUARTERS = 8;

export interface MetricRow {
  company_slug: string;
  metric_code: string;
  period: string;
  value: number | null;
  unit: string | null;
  source: IntelMetricSource;
}

// metric_code → XBRL concept candidates, tried in order (us-gaap taxonomy).
const XBRL_CONCEPTS: { code: string; unit: string; concepts: string[] }[] = [
  { code: 'revenue', unit: 'USD', concepts: ['Revenues', 'RevenuesNetOfInterestExpense'] },
  { code: 'net_income', unit: 'USD', concepts: ['NetIncomeLoss'] },
  { code: 'eps_diluted', unit: 'USD/share', concepts: ['EarningsPerShareDiluted'] },
  { code: 'provision_credit_losses', unit: 'USD', concepts: ['ProvisionForCreditLosses', 'ProvisionForLoanLeaseAndOtherLosses'] },
  { code: 'deposits', unit: 'USD', concepts: ['Deposits'] },
  { code: 'total_assets', unit: 'USD', concepts: ['Assets'] },
  { code: 'stockholders_equity', unit: 'USD', concepts: ['StockholdersEquity'] },
];

interface FactEntry {
  end?: string;
  val?: number;
  form?: string;
}

interface CompanyFactsPayload {
  facts?: { 'us-gaap'?: Record<string, { units?: Record<string, FactEntry[]> }> };
}

// Quarterly/annual report forms whose facts we trust (10-X for domestic
// filers, 20-F/40-F/6-K for foreign private issuers like Klarna).
const REPORT_FORM_RE = /^(10-[QK]|20-F|40-F|6-K)/;

async function fetchJson<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// EDGAR XBRL: latest quarters for each curated concept out of ONE
// companyfacts payload. Report-form facts only, deduped by period end keeping
// the last-reported value (a restatement supersedes), trailing MAX_QUARTERS.
export async function fetchEdgarMetrics(
  company: Pick<IntelCompany, 'slug' | 'cik'>,
  intelRunId?: string,
  quarters = MAX_QUARTERS
): Promise<MetricRow[]> {
  if (!company.cik) return [];
  const padded = company.cik.padStart(10, '0');
  const t0 = Date.now();
  // The companyfacts payload runs to several MB for big filers; one fetch per
  // company per Monday is the whole load.
  const payload = await edgarJson<CompanyFactsPayload>(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
    45_000
  );
  const gaap = payload.facts?.['us-gaap'] ?? {};
  const rows: MetricRow[] = [];
  for (const metric of XBRL_CONCEPTS) {
    // First concept candidate the filer actually reports wins.
    let series: FactEntry[] = [];
    for (const concept of metric.concepts) {
      const fam = gaap[concept]?.units ?? {};
      const arr = Object.values(fam)[0] ?? [];
      if (arr.length) {
        series = arr;
        break;
      }
    }
    const byEnd = new Map<string, number>();
    for (const f of series) {
      if (!f?.end || typeof f.val !== 'number') continue;
      if (f.form && !REPORT_FORM_RE.test(f.form)) continue;
      byEnd.set(f.end, f.val); // later entries are later filings; last write wins
    }
    const periods = [...byEnd.keys()].sort().slice(-quarters);
    for (const period of periods) {
      rows.push({
        company_slug: company.slug,
        metric_code: metric.code,
        period,
        value: byEnd.get(period) ?? null,
        unit: metric.unit,
        source: 'edgar_xbrl',
      });
    }
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'edgar-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, cik: company.cik, metrics: rows.length, provider: 'edgar_xbrl' },
  });
  return rows;
}

// FDIC BankFind: every numeric call-report-derived field the API exposes,
// not a curated handful. banks.data.fdic.gov 301s now; the new base is
// api.fdic.gov/banks. REPDTE arrives as yyyymmdd; the field dictionary
// carries no per-field unit (risview_properties.yaml has none worth trusting),
// so full-field rows go out with unit: null.
const FDIC_API = 'https://api.fdic.gov/banks';
const FDIC_FIELD_LIST_TTL_MS = 60 * 60 * 1000;
const FDIC_BATCH_SIZE = 80;

export interface FdicField {
  code: string;
  title: string;
}

// The six well-known mnemonics, kept as a fallback if the dictionary fetch
// or parse ever fails: never let a schema-change on FDIC's side zero out
// metrics collection entirely.
const FDIC_FALLBACK_FIELDS: FdicField[] = [
  { code: 'ASSET', title: 'Total assets' },
  { code: 'DEP', title: 'Total deposits' },
  { code: 'NETINC', title: 'Net income' },
  { code: 'ROA', title: 'Return on assets' },
  { code: 'ROE', title: 'Return on equity' },
  { code: 'NIMY', title: 'Net interest margin' },
];

let fdicFieldListCache: { fields: FdicField[]; expiresAt: number } | null = null;

// risview_properties.yaml is 616KB of machine-generated YAML; parsed with a
// line scanner instead of a yaml dependency. Field names sit at exactly
// 6-space indent, their type/title subkeys at exactly 8-space indent -
// everything else (description, deeper nesting) is ignored by construction.
export async function fetchFdicFieldList(): Promise<FdicField[]> {
  const now = Date.now();
  if (fdicFieldListCache && fdicFieldListCache.expiresAt > now) return fdicFieldListCache.fields;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${FDIC_API}/docs/risview_properties.yaml`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} for risview_properties.yaml`);
    const text = await res.text();
    const NAME_RE = /^ {6}([A-Z0-9_]+):\s*$/;
    const SUBKEY_RE = /^ {8}(type|title): (.*)$/;
    const fields: FdicField[] = [];
    let current: { code: string; type: string; title: string } | null = null;
    const flush = () => {
      if (current && current.type === 'number') {
        fields.push({ code: current.code, title: current.title || current.code });
      }
      current = null;
    };
    for (const line of text.split('\n')) {
      const nameMatch = NAME_RE.exec(line);
      if (nameMatch) {
        flush();
        current = { code: nameMatch[1], type: '', title: '' };
        continue;
      }
      const subMatch = current ? SUBKEY_RE.exec(line) : null;
      if (subMatch) {
        const value = subMatch[2].trim().replace(/^['"]|['"]$/g, '');
        if (subMatch[1] === 'type') current!.type = value;
        else current!.title = value;
      }
    }
    flush();
    fdicFieldListCache = { fields, expiresAt: now + FDIC_FIELD_LIST_TTL_MS };
    return fields;
  } finally {
    clearTimeout(timer);
  }
}

interface FdicPayload {
  data?: { data?: Record<string, unknown> }[];
}

// FDIC BankFind financials, full field set, batched 80 mnemonics per call
// (the API's practical query-length ceiling). Sequential batches, one retry
// each; a batch that still fails is skipped silently, so a dictionary this
// large degrades gracefully instead of failing the whole company.
export async function fetchFdicMetricsFull(
  company: Pick<IntelCompany, 'slug' | 'fdic_cert'>,
  quarters = MAX_QUARTERS,
  intelRunId?: string
): Promise<MetricRow[]> {
  if (!company.fdic_cert) return [];
  const t0 = Date.now();
  let fields: FdicField[];
  try {
    fields = await fetchFdicFieldList();
    if (!fields.length) fields = FDIC_FALLBACK_FIELDS;
  } catch {
    fields = FDIC_FALLBACK_FIELDS;
  }
  const rows: MetricRow[] = [];
  for (let i = 0; i < fields.length; i += FDIC_BATCH_SIZE) {
    const batch = fields.slice(i, i + FDIC_BATCH_SIZE);
    const codes = batch.map((f) => f.code).join(',');
    const url = `${FDIC_API}/financials?filters=CERT:${encodeURIComponent(company.fdic_cert)}` +
      `&fields=REPDTE,${codes}&sort_by=REPDTE&sort_order=DESC&limit=${quarters}&format=json`;
    let payload: FdicPayload | undefined;
    for (let attempt = 0; attempt < 2 && !payload; attempt++) {
      try {
        payload = await fetchJson<FdicPayload>(url);
      } catch {
        payload = undefined;
      }
    }
    if (!payload) continue; // failed batch after one retry, skip and move on
    for (const entry of payload.data ?? []) {
      const d = entry?.data ?? {};
      const rep = String(d.REPDTE ?? '');
      if (!/^\d{8}$/.test(rep)) continue;
      const period = `${rep.slice(0, 4)}-${rep.slice(4, 6)}-${rep.slice(6, 8)}`;
      for (const f of batch) {
        const v = d[f.code];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        rows.push({
          company_slug: company.slug,
          metric_code: `fdic_${f.code.toLowerCase()}`,
          period,
          value: v,
          unit: null,
          source: 'fdic',
        });
      }
    }
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'fdic-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, cert: company.fdic_cert, metrics: rows.length, fields: fields.length, provider: 'fdic' },
  });
  return rows;
}

interface CfpbPayload {
  hits?: { total?: { value?: number } | number };
}

const CFPB_API = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';

// The CFPB matches its own registered legal names (all-caps corporate form),
// not the registry display name, so every complaints fetch resolves a legal
// name first. The registry's cfpb_name overrides the automatic pick when it
// is wrong or empty for a given company (a name mismatch on the automatic
// path silently returns zero, or worse, a plausible-looking but unrelated
// company): null (the default) runs the automatic _suggest_company lookup
// and takes the first suggestion; an explicit empty string skips CFPB for
// that company on purpose (registered under no name at all); any other
// string is queried as-is. Shared by the 30-day snapshot and the monthly
// series below; no suggestion = the company is not in the CFPB database
// (most fintechs and non-banks), which is a skip, not an error.
async function resolveCfpbLegalName(
  company: Pick<IntelCompany, 'name' | 'cfpb_name'>
): Promise<string | undefined> {
  if (company.cfpb_name === '') return undefined;
  if (company.cfpb_name) return company.cfpb_name;
  const suggestions = await fetchJson<string[]>(
    `${CFPB_API}_suggest_company/?text=${encodeURIComponent(company.name)}`
  );
  return Array.isArray(suggestions) ? suggestions[0] : undefined;
}

// CFPB complaints: one trailing-30-day count, period-stamped to the first of
// the run month so re-runs within a month upsert the same row.
export async function fetchCfpbComplaints(
  company: Pick<IntelCompany, 'slug' | 'name' | 'cfpb_name'>,
  dayISO: string,
  intelRunId?: string
): Promise<MetricRow[]> {
  const t0 = Date.now();
  const legalName = await resolveCfpbLegalName(company);
  if (!legalName) return [];
  const min = new Date(`${dayISO}T00:00:00Z`);
  min.setUTCDate(min.getUTCDate() - 30);
  const payload = await fetchJson<CfpbPayload>(
    `${CFPB_API}?company=${encodeURIComponent(legalName)}` +
      `&date_received_min=${min.toISOString().slice(0, 10)}&size=1`
  );
  const total = payload.hits?.total;
  const value = typeof total === 'number' ? total : typeof total?.value === 'number' ? total.value : null;
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'cfpb-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, company: company.slug, provider: 'cfpb' },
  });
  if (value === null) return [];
  return [{
    company_slug: company.slug,
    metric_code: 'cfpb_complaints_30d',
    period: `${dayISO.slice(0, 7)}-01`,
    value,
    unit: 'complaints',
    source: 'cfpb',
  }];
}

// CFPB complaints, monthly series: one count per trailing full calendar
// month (the current, still-partial month is excluded), period-stamped to
// the first of that month. The name resolves once and every month reuses it.
export async function fetchCfpbMonthlySeries(
  company: Pick<IntelCompany, 'slug' | 'name' | 'cfpb_name'>,
  months = 24,
  intelRunId?: string
): Promise<MetricRow[]> {
  const t0 = Date.now();
  const legalName = await resolveCfpbLegalName(company);
  if (!legalName) return [];
  const rows: MetricRow[] = [];
  const now = new Date();
  for (let i = 1; i <= months; i++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const firstISO = first.toISOString().slice(0, 10);
    const lastISO = last.toISOString().slice(0, 10);
    try {
      const payload = await fetchJson<CfpbPayload>(
        `${CFPB_API}?company=${encodeURIComponent(legalName)}` +
          `&date_received_min=${firstISO}&date_received_max=${lastISO}&size=1`
      );
      const total = payload.hits?.total;
      const value = typeof total === 'number' ? total : typeof total?.value === 'number' ? total.value : null;
      if (value === null) continue;
      rows.push({
        company_slug: company.slug,
        metric_code: 'cfpb_complaints_month',
        period: firstISO,
        value,
        unit: 'complaints',
        source: 'cfpb',
      });
    } catch {
      continue; // skip a failed month silently, the rest of the series still lands
    }
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'cfpb-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, company: company.slug, months: rows.length, provider: 'cfpb' },
  });
  return rows;
}

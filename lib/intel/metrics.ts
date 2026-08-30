import { recordApiCall } from '../cost';
import { edgarJson } from './edgar';
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
//     the fetcher first resolves the registry name through the
//     _suggest_company endpoint and queries the first suggestion.

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

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
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
  intelRunId?: string
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
    const periods = [...byEnd.keys()].sort().slice(-MAX_QUARTERS);
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

// FDIC BankFind: well-known call-report-derived fields per cert. REPDTE
// arrives as yyyymmdd; values are thousands of dollars for balance fields
// (kept as reported, unit says so).
const FDIC_FIELDS: { field: string; code: string; unit: string }[] = [
  { field: 'ASSET', code: 'fdic_total_assets', unit: 'USD thousands' },
  { field: 'DEP', code: 'fdic_deposits', unit: 'USD thousands' },
  { field: 'NETINC', code: 'fdic_net_income', unit: 'USD thousands' },
  { field: 'ROA', code: 'fdic_roa', unit: 'percent' },
  { field: 'ROE', code: 'fdic_roe', unit: 'percent' },
  { field: 'NIMY', code: 'fdic_nim', unit: 'percent' },
];

interface FdicPayload {
  data?: { data?: Record<string, unknown> }[];
}

export async function fetchFdicMetrics(
  company: Pick<IntelCompany, 'slug' | 'fdic_cert'>,
  intelRunId?: string
): Promise<MetricRow[]> {
  if (!company.fdic_cert) return [];
  const t0 = Date.now();
  const fields = ['REPDTE', ...FDIC_FIELDS.map((f) => f.field)].join(',');
  const payload = await fetchJson<FdicPayload>(
    `https://banks.data.fdic.gov/api/financials?filters=CERT:${encodeURIComponent(company.fdic_cert)}` +
      `&fields=${fields}&sort_by=REPDTE&sort_order=DESC&limit=${MAX_QUARTERS}&format=json`
  );
  const rows: MetricRow[] = [];
  for (const entry of payload.data ?? []) {
    const d = entry?.data ?? {};
    const rep = String(d.REPDTE ?? '');
    if (!/^\d{8}$/.test(rep)) continue;
    const period = `${rep.slice(0, 4)}-${rep.slice(4, 6)}-${rep.slice(6, 8)}`;
    for (const f of FDIC_FIELDS) {
      const v = d[f.field];
      if (typeof v !== 'number') continue;
      rows.push({
        company_slug: company.slug,
        metric_code: f.code,
        period,
        value: v,
        unit: f.unit,
        source: 'fdic',
      });
    }
  }
  await recordApiCall({
    feature: 'intel_discovery',
    model: 'fdic-api',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { intel_run: intelRunId, cert: company.fdic_cert, metrics: rows.length, provider: 'fdic' },
  });
  return rows;
}

interface CfpbPayload {
  hits?: { total?: { value?: number } | number };
}

const CFPB_API = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';

// CFPB complaints: one trailing-30-day count, period-stamped to the first of
// the run month so re-runs within a month upsert the same row. The API
// matches registered legal names, so resolve the display name through
// _suggest_company first; no suggestion = the company is not in the CFPB
// database (most fintechs and non-banks), which is a skip, not an error.
export async function fetchCfpbComplaints(
  company: Pick<IntelCompany, 'slug' | 'name'>,
  dayISO: string,
  intelRunId?: string
): Promise<MetricRow[]> {
  const t0 = Date.now();
  const suggestions = await fetchJson<string[]>(
    `${CFPB_API}_suggest_company/?text=${encodeURIComponent(company.name)}`
  );
  const legalName = Array.isArray(suggestions) ? suggestions[0] : undefined;
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

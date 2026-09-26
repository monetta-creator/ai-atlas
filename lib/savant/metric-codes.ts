// The curated metric list Savant reads from the metrics warehouse
// (intel_metrics: FDIC call reports, FR Y-9C, EDGAR XBRL, CFPB complaints,
// ATS hiring counts). Keyed on metric codes, never company slugs. Every
// entry names its public series so a figure can carry a filing citation.
// Plain-Node loadable, no imports. Measured 2026-09-26: every code below is
// present for 12-13 banks (FDIC/Y-9C), 14-23 companies (EDGAR), 25 (CFPB),
// 9 (ATS), with periods through 2026-06-30 (quarterly) / 2026-08 (CFPB).

export type MetricSource = 'fdic' | 'y9c' | 'edgar_xbrl' | 'cfpb' | 'ats';

export interface MetricDef {
  code: string;
  label: string;
  source: MetricSource;
  unit: 'usd_thousands' | 'usd' | 'percent' | 'ratio' | 'count' | 'per_share';
  // Which direction a rise reads as: 'up' good (income, deposits), 'down'
  // good (efficiency ratio, provisions, complaints), 'neutral' (assets, roles).
  goodWhen: 'up' | 'down' | 'neutral';
  group: 'earnings' | 'balance' | 'efficiency' | 'credit' | 'customers' | 'hiring';
  ratio?: boolean;         // already a ratio/percent series (no deltas in dollars)
  // Flows reported year-to-date (FDIC, Y-9C) or as a mix of annual and
  // quarterly facts (EDGAR duration items) make a false series: Q1 always
  // "drops" against Q4, an annual fact towers over quarters. They stay in the
  // peer tables (Phase 2) but never in anomaly detection.
  anomalyEligible?: boolean;
}

export const METRIC_DEFS: MetricDef[] = [
  // FDIC BankFind standard fields (bank subsidiaries): the ready ratios.
  { code: 'fdic_eeffr', label: 'Efficiency ratio', source: 'fdic', unit: 'percent', goodWhen: 'down', group: 'efficiency', ratio: true },
  { code: 'fdic_roa', label: 'Return on assets', source: 'fdic', unit: 'percent', goodWhen: 'up', group: 'earnings', ratio: true },
  { code: 'fdic_roe', label: 'Return on equity', source: 'fdic', unit: 'percent', goodWhen: 'up', group: 'earnings', ratio: true },
  { code: 'fdic_nimy', label: 'Net interest margin', source: 'fdic', unit: 'percent', goodWhen: 'up', group: 'earnings', ratio: true },
  { code: 'fdic_ntlnlsr', label: 'Net charge-offs to loans', source: 'fdic', unit: 'percent', goodWhen: 'down', group: 'credit', ratio: true },
  { code: 'fdic_asset', label: 'Total assets', source: 'fdic', unit: 'usd_thousands', goodWhen: 'neutral', group: 'balance' },
  { code: 'fdic_dep', label: 'Total deposits', source: 'fdic', unit: 'usd_thousands', goodWhen: 'up', group: 'balance' },
  { code: 'fdic_netinc', label: 'Net income (YTD)', source: 'fdic', unit: 'usd_thousands', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'fdic_nonix', label: 'Noninterest expense (YTD)', source: 'fdic', unit: 'usd_thousands', goodWhen: 'down', group: 'efficiency', anomalyEligible: false },
  { code: 'fdic_nonii', label: 'Noninterest income (YTD)', source: 'fdic', unit: 'usd_thousands', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'fdic_elnatr', label: 'Provision for credit losses (YTD)', source: 'fdic', unit: 'usd_thousands', goodWhen: 'down', group: 'credit', anomalyEligible: false },
  // FR Y-9C (holding companies): the headline BHCK items.
  { code: 'y9c_bhck4340', label: 'Net income (YTD, holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'y9c_bhck2170', label: 'Total assets (holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'neutral', group: 'balance' },
  { code: 'y9c_bhck4093', label: 'Noninterest expense (holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'down', group: 'efficiency', anomalyEligible: false },
  { code: 'y9c_bhck4079', label: 'Noninterest income (holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'y9c_bhck4230', label: 'Provision for credit losses (holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'down', group: 'credit', anomalyEligible: false },
  { code: 'y9c_bhdm6631', label: 'Deposits, noninterest-bearing (holding co.)', source: 'y9c', unit: 'usd_thousands', goodWhen: 'up', group: 'balance' },
  // EDGAR XBRL (the standardized codes the intel engine writes).
  { code: 'net_income', label: 'Net income', source: 'edgar_xbrl', unit: 'usd', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'revenue', label: 'Revenue', source: 'edgar_xbrl', unit: 'usd', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'eps_diluted', label: 'Diluted EPS', source: 'edgar_xbrl', unit: 'per_share', goodWhen: 'up', group: 'earnings', anomalyEligible: false },
  { code: 'total_assets', label: 'Total assets', source: 'edgar_xbrl', unit: 'usd', goodWhen: 'neutral', group: 'balance' },
  { code: 'deposits', label: 'Deposits', source: 'edgar_xbrl', unit: 'usd', goodWhen: 'up', group: 'balance' },
  { code: 'provision_credit_losses', label: 'Provision for credit losses', source: 'edgar_xbrl', unit: 'usd', goodWhen: 'down', group: 'credit', anomalyEligible: false },
  // CFPB complaint database (monthly).
  { code: 'cfpb_complaints_month', label: 'CFPB complaints (month)', source: 'cfpb', unit: 'count', goodWhen: 'down', group: 'customers' },
  // ATS hiring counts (weekly snapshots).
  { code: 'ats_open_roles_ai_ml', label: 'Open AI/ML roles', source: 'ats', unit: 'count', goodWhen: 'neutral', group: 'hiring' },
  { code: 'ats_open_roles_agents', label: 'Open agent-related roles', source: 'ats', unit: 'count', goodWhen: 'neutral', group: 'hiring' },
  { code: 'ats_open_roles_engineering', label: 'Open engineering roles', source: 'ats', unit: 'count', goodWhen: 'neutral', group: 'hiring' },
  { code: 'ats_open_roles_total', label: 'Open roles, total', source: 'ats', unit: 'count', goodWhen: 'neutral', group: 'hiring' },
];

export const METRIC_BY_CODE: Record<string, MetricDef> = Object.fromEntries(METRIC_DEFS.map((m) => [m.code, m]));

export const METRIC_CODES: string[] = METRIC_DEFS.map((m) => m.code);

export function anomalyEligible(code: string): boolean {
  return METRIC_BY_CODE[code]?.anomalyEligible !== false;
}

// The public series behind each source, for the citation a figure carries.
// Built from the company's registry identifiers at pack time (Phase 2).
export const METRIC_SOURCE_LABEL: Record<MetricSource, string> = {
  fdic: 'FDIC BankFind (call report)',
  y9c: 'FR Y-9C (FFIEC NIC)',
  edgar_xbrl: 'SEC EDGAR company facts',
  cfpb: 'CFPB consumer complaint database',
  ats: 'public careers site',
};

export function metricSourceUrl(
  source: MetricSource,
  ids: { cik?: string | number | null; fdic_cert?: string | null; rssd_id?: string | null; cfpb_name?: string | null; ats_board?: string | null }
): string | null {
  switch (source) {
    case 'edgar_xbrl':
      return ids.cik != null && ids.cik !== '' ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(ids.cik).padStart(10, '0')}.json` : null;
    case 'fdic':
      return ids.fdic_cert ? `https://banks.data.fdic.gov/bankfind-suite/bankfind?cert=${encodeURIComponent(ids.fdic_cert)}` : null;
    case 'y9c':
      return ids.rssd_id ? `https://www.ffiec.gov/npw/Institution/Profile/${encodeURIComponent(ids.rssd_id)}` : null;
    case 'cfpb':
      return ids.cfpb_name
        ? `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(ids.cfpb_name)}`
        : 'https://www.consumerfinance.gov/data-research/consumer-complaints/';
    case 'ats':
      return ids.ats_board ?? null;
  }
}

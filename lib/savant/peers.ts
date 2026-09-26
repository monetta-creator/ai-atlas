import { q } from '../db';
import { METRIC_BY_CODE, metricSourceUrl } from './metric-codes';
import type { MetricSource } from './metric-codes';
import type { PeerMetricCell, PeerRow, SavantBrief, SavantPeers } from './types';

// Peer and market watch, the data half: the reader organization (the
// registry's `self` tier) beside its peer tiers, from public filings and
// feeds only. Every cell carries the public series it came from, built from
// the company's registry identifiers (CIK, FDIC cert, RSSD id, CFPB name):
// intel_metrics carries no url of its own. Key-gated content: it names the
// tracked companies. Never reads `notes` or `dossier`.

const TIER_LABEL: Record<string, string> = {
  card_issuer: 'Card issuers',
  consumer_bank: 'Consumer banks',
  fintech: 'Fintechs',
  tech_platform: 'Tech platforms',
  wildcard: 'Wildcards',
};
const TIER_ORDER = ['card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'];

// The columns of the peer table: ratios the reader compares first, then the
// balance sheet, then the two EDGAR items every company reports.
export const PEER_CODES = ['fdic_eeffr', 'fdic_roa', 'fdic_nimy', 'fdic_ntlnlsr', 'fdic_dep', 'total_assets', 'revenue', 'net_income'];

interface CompanyRow {
  slug: string; name: string; tier: string; cik: string | number | null; rssd_id: string | null; fdic_cert: string | null;
  cfpb_name: string | null; ats: { provider?: string; board?: string } | null;
}

interface MetricRow { company_slug: string; metric_code: string; period: string; value: number; rn: number }

export async function buildPeers(window: { from: string; to: string }): Promise<SavantPeers> {
  const companies = await q<CompanyRow>(
    `select slug, name, tier::text as tier, cik, rssd_id, fdic_cert, cfpb_name, ats
       from intel_companies where active order by tier, slug`
  );
  if (!companies.length) return { self: null, tiers: [], codes: [] };
  const slugs = companies.map((c) => c.slug);

  const codes = [...PEER_CODES, 'cfpb_complaints_month', 'ats_open_roles_ai_ml', 'ats_open_roles_agents', 'ats_open_roles_total'];
  const [metricRows, aiRows, aiTrailingRows, factRows, filingRows] = await Promise.all([
    q<MetricRow>(
      `select company_slug, metric_code, period::text as period, value::float as value, rn from (
         select company_slug, metric_code, period, value,
                row_number() over (partition by company_slug, metric_code order by period desc) as rn
           from intel_metrics where metric_code = any($1) and company_slug = any($2) and value is not null
       ) x where rn <= 2`,
      [codes, slugs]
    ),
    q<{ company_slug: string; n: number }>(
      `select company_slug, count(*)::int as n from intel_items
        where 'tech_ai' = any(dimensions) and created_at >= $1::timestamptz and created_at < $2::timestamptz
        group by 1`,
      [window.from, window.to]
    ),
    q<{ company_slug: string; n: number }>(
      `select company_slug, count(*)::int as n from intel_items
        where 'tech_ai' = any(dimensions) and created_at >= $1::timestamptz - interval '28 days' and created_at < $1::timestamptz
        group by 1`,
      [window.from]
    ),
    q<{ company_slug: string; n: number }>(
      `select company_slug, count(*)::int as n from intel_facts
        where created_at >= $1::timestamptz and created_at < $2::timestamptz group by 1`,
      [window.from, window.to]
    ),
    q<{ company_slug: string; headline: string | null; url: string; published_date: string | null; source_domain: string | null }>(
      `select company_slug, headline, url, to_char(published_date, 'YYYY-MM-DD') as published_date, source_domain
         from intel_items
        where (discovered_via = 'edgar' or doc_type::text = 'filing')
          and created_at >= $1::timestamptz and created_at < $2::timestamptz
        order by published_date desc nulls last, created_at desc`,
      [window.from, window.to]
    ),
  ]);

  const latest = new Map<string, { latest?: MetricRow; prev?: MetricRow }>();
  for (const r of metricRows) {
    const k = `${r.company_slug}|${r.metric_code}`;
    const e = latest.get(k) ?? {};
    if (r.rn === 1) e.latest = r; else e.prev = r;
    latest.set(k, e);
  }
  const count = (rows: { company_slug: string; n: number }[]) => new Map(rows.map((r) => [r.company_slug, r.n]));
  const ai = count(aiRows); const aiTrail = count(aiTrailingRows); const facts = count(factRows);
  const filings = new Map<string, SavantBrief[]>();
  for (const f of filingRows) {
    const arr = filings.get(f.company_slug) ?? [];
    if (arr.length < 3) arr.push({ title: f.headline ?? f.url, url: f.url, href: null, domain: f.source_domain, date: f.published_date, company: f.company_slug, kind: 'intel_item' });
    filings.set(f.company_slug, arr);
  }

  const rowFor = (c: CompanyRow): PeerRow => {
    const ids = { cik: c.cik, fdic_cert: c.fdic_cert, rssd_id: c.rssd_id, cfpb_name: c.cfpb_name, ats_board: c.ats?.board ?? null };
    const cell = (code: string): PeerMetricCell => {
      const def = METRIC_BY_CODE[code];
      const e = latest.get(`${c.slug}|${code}`);
      const l = e?.latest?.value ?? null; const p = e?.prev?.value ?? null;
      const delta = l != null && p != null ? l - p : null;
      return {
        code, label: def?.label ?? code, latest: l, period: e?.latest?.period ?? null, prev: p, delta,
        pct: delta != null && p ? delta / Math.abs(p) : null,
        unit: def?.unit ?? 'count', source: def?.source ?? 'edgar_xbrl',
        sourceUrl: def ? metricSourceUrl(def.source as MetricSource, ids) : null,
        goodWhen: def?.goodWhen ?? 'neutral',
      };
    };
    const cfpb = latest.get(`${c.slug}|cfpb_complaints_month`);
    const at = (code: string) => latest.get(`${c.slug}|${code}`)?.latest;
    return {
      slug: c.slug, name: c.name, tier: c.tier, isSelf: c.tier === 'self',
      metrics: PEER_CODES.map(cell),
      aiItems: ai.get(c.slug) ?? 0,
      aiItemsTrailing: Math.round(((aiTrail.get(c.slug) ?? 0) / 4) * 10) / 10,
      facts: facts.get(c.slug) ?? 0,
      filings: filings.get(c.slug) ?? [],
      cfpb: { latest: cfpb?.latest?.value ?? null, prev: cfpb?.prev?.value ?? null, period: cfpb?.latest?.period ?? null, sourceUrl: metricSourceUrl('cfpb', ids) },
      hiring: { aiMl: at('ats_open_roles_ai_ml')?.value ?? null, agents: at('ats_open_roles_agents')?.value ?? null, total: at('ats_open_roles_total')?.value ?? null, asOf: at('ats_open_roles_total')?.period ?? null },
    };
  };

  const rows = companies.map(rowFor);
  const self = rows.find((r) => r.isSelf) ?? null;
  const tiers = TIER_ORDER
    .map((tier) => ({ tier, label: TIER_LABEL[tier] ?? tier, rows: rows.filter((r) => r.tier === tier) }))
    .filter((t) => t.rows.length);
  return {
    self,
    tiers,
    codes: PEER_CODES.map((code) => ({ code, label: METRIC_BY_CODE[code]?.label ?? code, unit: METRIC_BY_CODE[code]?.unit ?? 'count', source: METRIC_BY_CODE[code]?.source ?? 'edgar_xbrl' })),
  };
}

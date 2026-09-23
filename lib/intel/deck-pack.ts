import { q } from '../db';
import { fetchLogoDataUris } from '../logo-fetch';
import { deckWindowFor, scoreCompany, rankMovers, quietCompanies, humanizeCode } from './deck-pure';
import type { IntelDeckCompany, IntelDeckPack, IntelDeckTier } from './deck-types';

// Builds the company intel deck's pack for one day from what the Intel Desk
// already stored: every ACTIVE company whose tier is not 'self' (a SQL
// predicate, asserted by the test suite), its items created in the
// press-to-press window (16:20 UTC to 16:20 UTC, Monday back to Friday),
// the facts extracted in that window, filings, and metric rows fetched in the
// window with the previous period for a delta. Logos are fetched once here and
// baked onto the pack so the PDF route stays network-free. No model call.

interface CompanyRow { slug: string; name: string; tier: string; domain: string | null; ticker: string | null }
interface ItemRow {
  id: string; company_slug: string; company_slugs: string[] | null; headline: string; url: string; source_domain: string | null;
  source_tier: number | null; published_date: string | null; significance: number | null; doc_type: string | null;
  summary: string | null; discovered_via: string | null; created_at: string;
}
interface FactRow { id: string; company_slug: string; dimension: string; fact: string; value_text: string | null; as_of: string | null; url: string | null }
interface MetricRow { company_slug: string; metric_code: string; period: string; value: number; unit: string | null; source: string; prev_value: number | null; prev_period: string | null }

const MAX_ITEMS = 6; const MAX_FACTS = 6; const MAX_FILINGS = 4; const MAX_METRICS = 4;

export async function buildIntelDeckPack(day: string): Promise<IntelDeckPack> {
  const w = deckWindowFor(day);

  const [companies, items, facts, metrics, issue] = await Promise.all([
    q<CompanyRow>(
      `select slug, name, tier::text as tier, domain, ticker
         from intel_companies where active = true and tier <> 'self' order by slug`
    ),
    q<ItemRow>(
      `select i.id::text as id, i.company_slug, i.company_slugs, i.headline, i.url, i.source_domain, i.source_tier,
              to_char(i.published_date, 'YYYY-MM-DD') as published_date, i.significance::float as significance,
              i.doc_type::text as doc_type, i.summary, i.discovered_via::text as discovered_via, i.created_at::text as created_at
         from intel_items i
        where i.created_at >= $1::timestamptz and i.created_at < $2::timestamptz
          and i.fetch_status is distinct from 'failed'
        order by i.significance desc nulls last, i.created_at desc`,
      [w.from, w.to]
    ),
    q<FactRow>(
      `select f.id::text as id, f.company_slug, f.dimension, f.fact, f.value_text, to_char(f.as_of, 'YYYY-MM-DD') as as_of, i.url
         from intel_facts f left join intel_items i on i.id = f.item_id
        where f.created_at >= $1::timestamptz and f.created_at < $2::timestamptz
        order by f.created_at desc`,
      [w.from, w.to]
    ),
    q<MetricRow>(
      `with fresh as (
         select company_slug, metric_code, period, value::float as value, unit, source
           from intel_metrics
          where fetched_at >= $1::timestamptz and fetched_at < $2::timestamptz
       ), latest as (
         select distinct on (company_slug, metric_code, source) * from fresh
          order by company_slug, metric_code, source, period desc
       )
       select l.*, p.value::float as prev_value, p.period as prev_period
         from latest l
         left join lateral (
           select value, period from intel_metrics m
            where m.company_slug = l.company_slug and m.metric_code = l.metric_code and m.source = l.source and m.period < l.period
            order by m.period desc limit 1
         ) p on true
        order by l.company_slug, l.metric_code`,
      [w.from, w.to]
    ),
    q<{ n: number }>(`select count(*)::int as n from generated_reports where kind = 'intel_deck' and scope_to < $1::date`, [day]),
  ]);

  const active = new Map(companies.map((c) => [c.slug, c]));
  const byCompany = new Map<string, IntelDeckCompany>();
  const ensure = (slug: string): IntelDeckCompany | null => {
    const c = active.get(slug);
    if (!c) return null;
    let entry = byCompany.get(slug);
    if (!entry) {
      entry = { slug: c.slug, name: c.name, tier: c.tier as IntelDeckTier, domain: c.domain, ticker: c.ticker, logoDataUri: null, items: [], facts: [], filings: [], metrics: [], score: 0 };
      byCompany.set(slug, entry);
    }
    return entry;
  };

  const outlets = new Set<string>();
  for (const it of items) {
    // An item can be linked to several tracked companies; it counts for each.
    const slugs = Array.from(new Set([it.company_slug, ...(it.company_slugs ?? [])].filter(Boolean)));
    const isFiling = it.discovered_via === 'edgar' || it.doc_type === 'filing';
    if (it.source_domain) outlets.add(it.source_domain);
    for (const slug of slugs) {
      const entry = ensure(slug);
      if (!entry) continue;
      if (isFiling) {
        if (entry.filings.length < MAX_FILINGS) entry.filings.push({ id: it.id, headline: it.headline, url: it.url, publishedDate: it.published_date });
      } else if (entry.items.length < MAX_ITEMS) {
        entry.items.push({ id: it.id, headline: it.headline, url: it.url, domain: it.source_domain, sourceTier: it.source_tier, publishedDate: it.published_date, significance: it.significance, docType: it.doc_type, summary: it.summary });
      }
    }
  }
  for (const f of facts) {
    const entry = ensure(f.company_slug);
    if (!entry || entry.facts.length >= MAX_FACTS) continue;
    entry.facts.push({ id: f.id, dimension: f.dimension, fact: f.fact, valueText: f.value_text, asOf: f.as_of, url: f.url });
  }
  for (const m of metrics) {
    const entry = ensure(m.company_slug);
    if (!entry || entry.metrics.length >= MAX_METRICS) continue;
    const deltaPct = m.prev_value != null && m.prev_value !== 0 ? ((m.value - m.prev_value) / Math.abs(m.prev_value)) * 100 : null;
    entry.metrics.push({ code: m.metric_code, label: humanizeCode(m.metric_code), period: m.period, value: m.value, unit: m.unit, prevValue: m.prev_value, prevPeriod: m.prev_period, deltaPct, source: m.source });
  }

  const present = [...byCompany.values()].filter((c) => c.items.length || c.facts.length || c.filings.length || c.metrics.length);
  for (const c of present) c.score = scoreCompany(c);
  present.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  const logos = await fetchLogoDataUris(present.map((c) => c.domain));
  present.forEach((c, i) => { c.logoDataUri = logos[i]; });

  const quiet = quietCompanies(companies, new Set(present.map((c) => c.slug)));
  const numbers = {
    companies: present.length,
    quiet: quiet.length,
    items: present.reduce((n, c) => n + c.items.length, 0),
    facts: present.reduce((n, c) => n + c.facts.length, 0),
    filings: present.reduce((n, c) => n + c.filings.length, 0),
    metrics: present.reduce((n, c) => n + c.metrics.length, 0),
    outlets: outlets.size,
  };
  const movers = rankMovers(present, 3);

  return {
    day, windowFrom: w.from, windowTo: w.to,
    issueNumber: (issue[0]?.n ?? 0) + 1,
    numbers,
    stats: { companies: numbers.companies, movers: movers.length, quiet: numbers.quiet, items: numbers.items, facts: numbers.facts },
    companies: present, quiet, movers,
    generatedAt: new Date().toISOString(),
  };
}

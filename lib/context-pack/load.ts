// The company context pack, the DB half: reads one company's (or every
// active company's) public rows into the PackInput that core.ts renders.
//
// Query access is INJECTED (the datasets contract, lib/datasets/core.ts) so
// the dataset builder, the route and the plain-Node tests drive the same SQL.
//
// What is read, and what never is: intel_companies contributes name, tier,
// public_blurb, public_profile and the public registry identifiers. `notes`
// and `dossier` appear in no SELECT list here. Seven batched queries serve
// any number of companies; intel_metrics is only ever read by curated metric
// code and company (it holds about two million rows).

import type { Q } from '../datasets/core';
import { METRIC_BY_CODE, METRIC_CODES, metricSourceUrl } from '../savant/metric-codes.ts';
import type {
  PackBrief, PackFact, PackInput, PackItem, PackMetricSeries, PackPeerRow, PackRecord, PackTimelineEvent,
} from './core.ts';

// The peer table's columns: the ratios first, then the balance sheet, then
// the two EDGAR items every listed company reports (lib/savant/peers.ts).
export const PACK_PEER_CODES = ['fdic_eeffr', 'fdic_roa', 'fdic_nimy', 'fdic_ntlnlsr', 'total_assets', 'revenue', 'net_income'];

interface CompanyRow {
  slug: string; name: string; tier: string; public_blurb: string | null;
  public_profile: { sentences?: { text: string; record_ids: string[] }[] } | null;
  cik: string | null; fdic_cert: string | null; rssd_id: string | null; cfpb_name: string | null; domain: string | null;
  ats: { board?: string } | null;
}

export interface PackCompanySummary { slug: string; name: string; tier: string; domain: string | null; deepRecord: boolean }

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// The companies a pack exists for: every active registry row, the reader
// organization first, then by tier and name. `deepRecord` is derived from the
// data (a backfilled record exists), so no flag can drift from it.
export async function listPackCompanies(q: Q): Promise<PackCompanySummary[]> {
  const rows = await q<{ slug: string; name: string; tier: string; domain: string | null; deep: boolean }>(
    `select c.slug, c.name, c.tier::text as tier, c.domain,
            exists (select 1 from self_record r where r.company_slug = c.slug) as deep
       from intel_companies c
      where c.active
      order by (c.tier = 'self') desc, c.tier, c.name, c.slug`
  );
  return rows.map((r) => ({ slug: r.slug, name: r.name, tier: r.tier, domain: r.domain, deepRecord: r.deep }));
}

async function loadBriefs(q: Q, slugs: string[]): Promise<Map<string, PackBrief[]>> {
  const out = new Map<string, PackBrief[]>();
  // The briefs table arrives with migration 0080; a deploy that runs before
  // the migration renders packs without briefs rather than failing.
  const exists = await q<{ t: string | null }>(`select to_regclass('public.context_pack_briefs')::text as t`);
  if (!exists[0]?.t) return out;
  const rows = await q<{ company_slug: string; section_id: string; body: string; cite_urls: string[]; model: string | null; week_end: string }>(
    `select distinct on (company_slug, section_id)
            company_slug, section_id, body, cite_urls, model, to_char(week_end, 'YYYY-MM-DD') as week_end
       from context_pack_briefs
      where company_slug = any($1)
      order by company_slug, section_id, week_end desc`,
    [slugs]
  );
  for (const r of rows) {
    const list = out.get(r.company_slug) ?? [];
    list.push({ sectionId: r.section_id, body: r.body, citeUrls: r.cite_urls ?? [], model: r.model, weekEnd: r.week_end });
    out.set(r.company_slug, list);
  }
  return out;
}

function groupBy<T extends { company_slug: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.company_slug) ?? [];
    list.push(r); out.set(r.company_slug, list);
  }
  return out;
}

// One PackInput per requested company, in listPackCompanies order. `slug`
// null means every active company. An unknown or inactive slug returns [].
export async function loadPackInputs(q: Q, slug: string | null, asOf: string = todayUtc()): Promise<PackInput[]> {
  const companies = await q<CompanyRow>(
    `select slug, name, tier::text as tier, public_blurb, public_profile,
            cik::text as cik, fdic_cert, rssd_id, cfpb_name, domain, ats
       from intel_companies
      where active
      order by (tier = 'self') desc, tier, name, slug`
  );
  const wanted = slug ? companies.filter((c) => c.slug === slug) : companies;
  if (!wanted.length) return [];
  const slugs = wanted.map((c) => c.slug);
  const allSlugs = companies.map((c) => c.slug);

  const [records, timeline, facts, items, metrics, peerMetrics, briefs] = await Promise.all([
    q<{ company_slug: string; id: string; source: string; title: string; url: string; date: string | null; summary: string | null; ai_related: boolean; ai_passages: string[] }>(
      `select company_slug, id::text as id, source, title, url, to_char(published_date, 'YYYY-MM-DD') as date,
              summary, ai_related, ai_passages
         from self_record where company_slug = any($1)
        order by company_slug, published_date desc nulls last, id`,
      [slugs]
    ),
    q<{ company_slug: string; date: string; category: string; headline: string; body: string | null; record_ids: string[] }>(
      `select company_slug, to_char(event_date, 'YYYY-MM-DD') as date, category, headline, body, record_ids::text[] as record_ids
         from self_timeline where company_slug = any($1)
        order by company_slug, event_date desc, id`,
      [slugs]
    ),
    q<{ company_slug: string; dimension: string; fact: string; value_text: string | null; as_of: string | null; url: string | null }>(
      `select f.company_slug, f.dimension, f.fact, f.value_text, to_char(f.as_of, 'YYYY-MM-DD') as as_of, i.url
         from intel_facts f left join intel_items i on i.id = f.item_id
        where f.company_slug = any($1)
        order by f.company_slug, f.as_of desc nulls last, f.id`,
      [slugs]
    ),
    // One row per article: the same URL collected on two days keeps its
    // latest enriched copy.
    q<{ company_slug: string; headline: string | null; url: string; domain: string | null; date: string | null; summary: string | null; significance: number | null }>(
      `select distinct on (company_slug, normalized_url)
              company_slug, headline, url, source_domain as domain, to_char(published_date, 'YYYY-MM-DD') as date,
              summary, significance::float as significance
         from intel_items
        where company_slug = any($1) and headline is not null
        order by company_slug, normalized_url, (summary is not null) desc, created_at desc, id`,
      [slugs]
    ),
    q<{ company_slug: string; metric_code: string; period: string; value: number }>(
      `select company_slug, metric_code, to_char(period, 'YYYY-MM-DD') as period, value::float as value
         from intel_metrics
        where metric_code = any($1) and company_slug = any($2) and value is not null
        order by company_slug, metric_code, period desc, source`,
      [METRIC_CODES, slugs]
    ),
    q<{ company_slug: string; metric_code: string; period: string; value: number }>(
      `select company_slug, metric_code, to_char(period, 'YYYY-MM-DD') as period, value::float as value from (
         select company_slug, metric_code, period, value,
                row_number() over (partition by company_slug, metric_code order by period desc, source) as rn
           from intel_metrics
          where metric_code = any($1) and company_slug = any($2) and value is not null
       ) x where rn = 1
       order by company_slug, metric_code`,
      [PACK_PEER_CODES, allSlugs]
    ),
    loadBriefs(q, slugs),
  ]);

  const recordsBy = groupBy(records); const timelineBy = groupBy(timeline); const factsBy = groupBy(facts);
  const itemsBy = groupBy(items); const metricsBy = groupBy(metrics); const peerBy = groupBy(peerMetrics);

  const idsOf = (c: CompanyRow) => ({ cik: c.cik, fdic_cert: c.fdic_cert, rssd_id: c.rssd_id, cfpb_name: c.cfpb_name, ats_board: c.ats?.board ?? null });
  const peerRow = (c: CompanyRow, subject: string): PackPeerRow => {
    const mine = peerBy.get(c.slug) ?? [];
    const cells = PACK_PEER_CODES.map((code) => {
      const m = mine.find((x) => x.metric_code === code);
      return { code, value: m?.value ?? null, period: m?.period ?? null };
    });
    const urls = new Set<string>();
    for (const cell of cells) {
      if (cell.value == null) continue;
      const def = METRIC_BY_CODE[cell.code];
      const url = def ? metricSourceUrl(def.source, idsOf(c)) : null;
      if (url) urls.add(url);
    }
    return { name: c.name, tier: c.tier, isSubject: c.slug === subject, cells, urls: [...urls] };
  };

  return wanted.map((c): PackInput => {
    const recs = recordsBy.get(c.slug) ?? [];
    const urlById = new Map(recs.map((r) => [r.id, r.url]));
    const urlsFor = (ids: string[] | null | undefined) =>
      (ids ?? []).map((id) => urlById.get(id)).filter((u): u is string => Boolean(u));

    const series = new Map<string, PackMetricSeries>();
    for (const m of metricsBy.get(c.slug) ?? []) {
      const s = series.get(m.metric_code) ?? { code: m.metric_code, points: [] };
      // One value per period: the same code from two sources keeps the first.
      if (!s.points.some((p) => p.period === m.period)) s.points.push({ period: m.period, value: m.value });
      series.set(m.metric_code, s);
    }

    return {
      asOf,
      company: {
        slug: c.slug, name: c.name, tier: c.tier, publicBlurb: c.public_blurb, domain: c.domain,
        deepRecord: recs.length > 0, ids: idsOf(c),
      },
      profile: (c.public_profile?.sentences ?? []).map((s) => ({ text: s.text, urls: urlsFor(s.record_ids) })),
      timeline: (timelineBy.get(c.slug) ?? []).map((t): PackTimelineEvent => ({
        date: t.date, category: t.category, headline: t.headline, body: t.body, urls: urlsFor(t.record_ids),
      })),
      records: recs.map((r): PackRecord => ({
        source: r.source, title: r.title, url: r.url, date: r.date, summary: r.summary,
        aiRelated: r.ai_related, aiPassages: r.ai_passages ?? [],
      })),
      facts: (factsBy.get(c.slug) ?? []).map((f): PackFact => ({
        dimension: f.dimension, fact: f.fact, valueText: f.value_text, asOf: f.as_of, url: f.url,
      })),
      items: (itemsBy.get(c.slug) ?? []).map((i): PackItem => ({
        headline: i.headline ?? i.url, url: i.url, domain: i.domain, date: i.date, summary: i.summary, significance: i.significance,
      })),
      metrics: [...series.values()],
      peerCodes: PACK_PEER_CODES,
      peers: companies.map((p) => peerRow(p, c.slug)),
      briefs: briefs.get(c.slug) ?? [],
    };
  });
}

export async function loadPackInput(q: Q, slug: string, asOf?: string): Promise<PackInput | null> {
  const [input] = await loadPackInputs(q, slug, asOf);
  return input ?? null;
}

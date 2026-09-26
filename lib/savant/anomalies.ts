import { q } from '../db';
import { METRIC_CODES } from './metric-codes';
import { metricAnomalies, volumeAnomalies, silentLenses } from './anomalies-core';
import type { MetricSeries } from './anomalies-core';
import type { AnomalyPayload } from './types';
import type { NotebookEntry } from '../mutations/savant';

// Savant's anomalies leg: metric series from the warehouse that moved more
// than 2σ against their own trailing window (curated codes only; latest
// PERIOD selected, never fetched_at, which has no index over 2M rows), item
// volume spikes per scan topic and per intel company against the trailing
// four weeks, and lenses no published signal touched this week. All
// deterministic; the pure math is in ./anomalies-core.ts.

const SIGNAL_LENSES = ['market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society'];

// The last 9 periods per (company, code) for the curated codes: 8 of history
// plus the latest. One indexed scan per code family.
async function loadMetricSeries(): Promise<MetricSeries[]> {
  const rows = await q<{ company_slug: string; metric_code: string; period: string; value: number }>(
    `select company_slug, metric_code, period::text as period, value::float as value
       from (
         select company_slug, metric_code, period, value,
                row_number() over (partition by company_slug, metric_code order by period desc) as rn
           from intel_metrics
          where metric_code = any($1) and value is not null
       ) x
      where rn <= 9
      order by company_slug, metric_code, period`,
    [METRIC_CODES]
  );
  const map = new Map<string, MetricSeries>();
  for (const r of rows) {
    const k = `${r.company_slug}|${r.metric_code}`;
    const s = map.get(k) ?? { company: r.company_slug, code: r.metric_code, points: [] };
    s.points.push({ period: r.period, value: r.value });
    map.set(k, s);
  }
  return [...map.values()];
}

async function loadVolumes(weekFrom: string, weekTo: string): Promise<{
  topics: { current: Record<string, number>; trailing: Record<string, number[]>; labels: Record<string, string> };
  companies: { current: Record<string, number>; trailing: Record<string, number[]>; labels: Record<string, string> };
}> {
  // Weekly buckets: this week plus the four before it, by created_at.
  const topicRows = await q<{ topic_slug: string; name: string; wk: number; n: number }>(
    `select si.topic_slug, t.name,
            floor(extract(epoch from ($2::timestamptz - si.created_at)) / 604800)::int as wk,
            count(*)::int as n
       from scan_items si join scan_topics t on t.slug = si.topic_slug
      where si.created_at >= $1::timestamptz - interval '28 days' and si.created_at < $2::timestamptz
      group by 1, 2, 3`,
    [weekFrom, weekTo]
  );
  const companyRows = await q<{ company_slug: string; name: string; wk: number; n: number }>(
    `select ii.company_slug, c.name,
            floor(extract(epoch from ($2::timestamptz - ii.created_at)) / 604800)::int as wk,
            count(*)::int as n
       from intel_items ii join intel_companies c on c.slug = ii.company_slug
      where ii.created_at >= $1::timestamptz - interval '28 days' and ii.created_at < $2::timestamptz
      group by 1, 2, 3`,
    [weekFrom, weekTo]
  );
  const fold = <R extends { wk: number; n: number; name: string }>(rows: R[], key: (r: R) => string) => {
    const current: Record<string, number> = {};
    const trailing: Record<string, number[]> = {};
    const labels: Record<string, string> = {};
    for (const r of rows) {
      const k = key(r);
      labels[k] = r.name;
      if (r.wk === 0) current[k] = (current[k] ?? 0) + r.n;
      else {
        trailing[k] = trailing[k] ?? [0, 0, 0, 0];
        if (r.wk >= 1 && r.wk <= 4) trailing[k][r.wk - 1] += r.n;
      }
    }
    for (const k of Object.keys(trailing)) current[k] = current[k] ?? 0;
    return { current, trailing, labels };
  };
  return {
    topics: fold(topicRows, (r) => r.topic_slug),
    companies: fold(companyRows, (r) => r.company_slug),
  };
}

async function loadLensCounts(weekFrom: string, weekTo: string): Promise<Record<string, number>> {
  const rows = await q<{ lens: string; n: number }>(
    `select l.lens::text as lens, count(*)::int as n
       from signals s, unnest(s.lenses) as l(lens)
      where s.is_published and s.first_published_at >= $1::timestamptz and s.first_published_at < $2::timestamptz
      group by 1`,
    [weekFrom, weekTo]
  );
  const out: Record<string, number> = Object.fromEntries(SIGNAL_LENSES.map((l) => [l, 0]));
  for (const r of rows) out[r.lens] = r.n;
  return out;
}

export async function anomalyEntries(weekFrom: string, dayTo: string, isFriday: boolean): Promise<{ entries: NotebookEntry[]; stats: { metric: number; volume: number; silent: number } }> {
  const series = await loadMetricSeries();
  const metric = metricAnomalies(series, { window: 8, minZ: 2, asOf: dayTo.slice(0, 10), freshDays: 120, mode: 'delta', perCompany: 3, max: 20 });
  const vols = await loadVolumes(weekFrom, dayTo);
  const volume = [
    ...volumeAnomalies(vols.topics.current, vols.topics.trailing, 'volume_topic', vols.topics.labels, { minZ: 2, minLatest: 5 }),
    ...volumeAnomalies(vols.companies.current, vols.companies.trailing, 'volume_company', vols.companies.labels, { minZ: 2, minLatest: 5 }),
  ];
  // Silence is a week-level judgment; only the Friday pass records it.
  const silent = isFriday ? silentLenses(await loadLensCounts(weekFrom, dayTo), SIGNAL_LENSES) : [];
  const all: AnomalyPayload[] = [...metric, ...volume, ...silent];
  const entries: NotebookEntry[] = all.map((a) => ({
    kind: 'anomaly',
    // The source is in the key: FDIC and EDGAR both ship a "Total assets" series.
    key: `${a.kind}:${a.subject}:${a.source ?? ''}:${a.label}:${a.period ?? ''}`,
    payload: a,
  }));
  return { entries, stats: { metric: metric.length, volume: volume.length, silent: silent.length } };
}

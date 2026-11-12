// metrics: reported numbers from intel_metrics (the ~2M-row warehouse) for one
// company. Every query leads with company_slug (and metric_code when given),
// hitting intel_metrics_company_slug_metric_code_period_idx; never an
// unkeyed scan. Values are returned as stored, never computed.
import { q } from '../db';
import type { AtlasTool } from './types';
import { clipLines, isErr, isObj, optText, parseDate, parseLimit, SLUG_RE, snip } from './reach-shared';

export interface MetricsInput {
  company: string;
  series?: string;
  from?: string;
  to?: string;
  limit: number;
}

export interface MetricRow { metric_code: string; period: string; value: number; unit: string | null; source: string | null }

// The one metrics query (shared by the text tool and show_view). Leads with
// company_slug so it rides the (company, metric, period) index.
export async function queryMetrics(p: MetricsInput): Promise<MetricRow[]> {
  const params: unknown[] = [p.company];
  const where = ['company_slug = $1'];
  if (p.series) {
    params.push(`%${p.series.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`metric_code ilike $${params.length}`);
  }
  if (p.from) { params.push(p.from); where.push(`period >= $${params.length}::date`); }
  if (p.to) { params.push(p.to); where.push(`period <= $${params.length}::date`); }
  return q<MetricRow>(
    `select metric_code, to_char(period, 'YYYY-MM-DD') as period, value, unit, source
       from intel_metrics
      where ${where.join(' and ')}
      order by period desc, metric_code
      limit ${Math.max(1, Math.min(200, Math.floor(p.limit)))}`,
    params
  );
}

const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(v * 10000) / 10000);
};

export const metricsTool: AtlasTool<MetricsInput> = {
  name: 'metrics',
  description:
    'Reported numbers for one tracked company: regulatory and filing metrics (deposits, complaint counts, SEC filing line items, and similar), as a compact table of series, period, value, unit, and source. Give the company slug and optionally a series name fragment (for example "deposits" or "complaints") and a period range. With no series, also lists the series available for that company. Values are stored data, quote them as given.',
  inputSchema: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'Tracked-company slug, for example "ally".' },
      series: { type: 'string', description: 'Optional metric name fragment to match, for example "deposits". Matches metric codes containing it.' },
      from: { type: 'string', description: 'Optional earliest period, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Optional latest period, YYYY-MM-DD.' },
      limit: { type: 'integer', description: 'Max rows, 1 to 40, default 25.' },
    },
    required: ['company'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    if (!isObj(input)) return 'Input must be an object.';
    const c = optText(input.company, 'company', 64);
    if (isErr(c)) return c.error;
    const company = c?.toLowerCase();
    if (!company || !SLUG_RE.test(company)) return 'company is required: a tracked-company slug like "ally".';
    const s = optText(input.series, 'series', 80);
    if (isErr(s)) return s.error;
    const from = parseDate(input.from, 'from');
    if (isErr(from)) return from.error;
    const to = parseDate(input.to, 'to');
    if (isErr(to)) return to.error;
    return { company, series: s?.toLowerCase(), from, to, limit: parseLimit(input.limit, 25, 40) };
  },
  async run(p, ctx) {
    ctx.status?.(`Reading metrics for ${p.company}${p.series ? ` (${snip(p.series, 30)})` : ''}`);
    const rows = await queryMetrics(p);

    const lines: string[] = [];
    if (!rows.length) {
      lines.push(`No metric rows for ${p.company}${p.series ? ` matching "${p.series}"` : ''} in that range.`);
    } else {
      lines.push(`${rows.length} row${rows.length === 1 ? '' : 's'} for ${p.company}, newest period first (series | period | value | unit | source):`);
      for (const r of rows) {
        lines.push(`${snip(r.metric_code, 70)} | ${r.period} | ${fmt(r.value)} | ${r.unit ?? '-'} | ${snip(r.source, 30) || '-'}`);
      }
    }
    if (!p.series || !rows.length) {
      const avail = await q<{ metric_code: string; n: string; latest: string }>(
        `select metric_code, count(*)::text as n, to_char(max(period), 'YYYY-MM-DD') as latest
           from intel_metrics where company_slug = $1
          group by metric_code order by max(period) desc, metric_code limit 40`,
        [p.company]
      );
      lines.push('', `Series available for ${p.company} (most recently reported first, up to 40; series | rows | latest period):`);
      for (const a of avail) lines.push(`${snip(a.metric_code, 70)} | ${a.n} | ${a.latest}`);
      if (!avail.length) lines.push('none: no metrics recorded for this slug.');
    }
    return { text: clipLines(lines) };
  },
};

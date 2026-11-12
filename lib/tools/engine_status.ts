// engine_status: admin ops read. Latest run per engine, failures in the last
// 7 days, model spend today and month to date by feature, Tavily quota.
// Database only; no network calls.
import { q, one } from '../db';
import { getTavilyQuota } from '../data/intel';
import { capText, clip, ymd } from './util-b';
import type { AtlasTool } from './types';

interface RunRow {
  day: string | null; status: string; step: string | null; notes: number; fin: Date | string | null; error: string | null;
}

// Fixed table list: no user input reaches these statements.
const ENGINES: { name: string; table: string; day: string; notes: boolean }[] = [
  { name: 'scan', table: 'scan_runs', day: `to_char(day, 'YYYY-MM-DD')`, notes: true },
  { name: 'intel', table: 'intel_runs', day: `to_char(day, 'YYYY-MM-DD')`, notes: true },
  { name: 'research', table: 'research_runs', day: `to_char(day, 'YYYY-MM-DD')`, notes: true },
  { name: 'pipeline', table: 'pipeline_runs', day: `to_char(triggered_at, 'YYYY-MM-DD')`, notes: true },
  { name: 'tooling', table: 'tooling_runs', day: `to_char(day, 'YYYY-MM-DD')`, notes: true },
  { name: 'scout', table: 'scout_runs', day: `to_char(triggered_at, 'YYYY-MM-DD')`, notes: false },
];

const MONTH = `date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;
const TODAY = `date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;

export const engineStatusTool: AtlasTool<Record<string, never>> = {
  name: 'engine_status',
  description:
    'Admin only. Health of the collection engines: each engine\'s latest run (scan, intel, research, pipeline, tooling, scout) with day, status, step, notes count and finish time; failed runs in the last 7 days with the error; model spend today and month to date by feature (top 10); and Tavily search quota use. Read-only, no arguments.',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  scopes: ['admin'],
  parse() {
    return {};
  },
  async run(_p, ctx) {
    ctx.status?.('Checking the engines');
    const lines: string[] = ['Engines, latest run:'];
    const results = await Promise.all(
      ENGINES.map(async (e) => {
        const [latest, failed] = await Promise.all([
          one<RunRow>(
            `select ${e.day} as day, status::text as status, step::text as step,
                    ${e.notes ? 'coalesce(array_length(notes, 1), 0)' : '0'}::int as notes, updated_at as fin, error
               from ${e.table} order by created_at desc limit 1`
          ),
          q<{ day: string; step: string | null; error: string | null }>(
            `select ${e.day} as day, step::text as step, error from ${e.table}
              where status = 'failed' and created_at >= now() - interval '7 days'
              order by created_at desc limit 3`
          ),
        ]);
        return { e, latest, failed };
      })
    );
    for (const { e, latest } of results) {
      lines.push(latest
        ? `- ${e.name}: ${latest.day} ${latest.status}, step ${latest.step ?? '–'}, ${latest.notes} notes, updated ${ymd(latest.fin)}${latest.error ? `, error: ${clip(latest.error, 80)}` : ''}`
        : `- ${e.name}: no runs`);
    }
    const fails = results.flatMap(({ e, failed }) =>
      failed.map((f) => `- ${e.name} ${f.day}${f.step ? ` at ${f.step}` : ''}: ${clip(f.error, 120) || 'no error text'}`));
    lines.push('Failed runs, last 7 days:');
    lines.push(...(fails.length ? fails : ['- none']));

    const [spend, tot] = await Promise.all([
      q<{ feature: string; today: string; mtd: string }>(
        `select feature,
                coalesce(sum(cost_usd) filter (where created_at >= ${TODAY}), 0)::text as today,
                coalesce(sum(cost_usd), 0)::text as mtd
           from ai_cost_log where created_at >= ${MONTH}
          group by feature order by sum(cost_usd) desc nulls last limit 10`
      ),
      one<{ today: string; mtd: string }>(
        `select coalesce(sum(cost_usd) filter (where created_at >= ${TODAY}), 0)::text as today,
                coalesce(sum(cost_usd), 0)::text as mtd
           from ai_cost_log where created_at >= ${MONTH}`
      ),
    ]);
    const usd = (s: string) => `$${Number(s).toFixed(2)}`;
    lines.push(`Model spend (UTC): today ${usd(tot?.today ?? '0')}, month to date ${usd(tot?.mtd ?? '0')}. Top features:`);
    lines.push(...(spend.length ? spend.map((r) => `- ${r.feature}: today ${usd(r.today)}, month ${usd(r.mtd)}`) : ['- none']));

    try {
      const t = await getTavilyQuota();
      lines.push(`Tavily quota: ${t.used} of ${t.cap} credits used this month, projected ${t.projected}${t.capHit ? ', cap hit in a recent run' : ''}.`);
    } catch {
      lines.push('Tavily quota: unavailable.');
    }
    return { text: capText(lines) };
  },
};

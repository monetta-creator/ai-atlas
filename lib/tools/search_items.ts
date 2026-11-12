// search_items: filtered, ranked search over scan items and intel (company)
// items. Neither table carries a stored tsvector, so ranking computes
// to_tsvector inline over the date/topic/company-filtered rows (tables are
// ~12k and ~7k rows).
import { q } from '../db';
import { ORQ } from '../pack-shared';
import { citeToken } from '../ask/deep';
import type { AtlasTool } from './types';
import { clipLines, isErr, isObj, optText, parseDate, parseLimit, SLUG_RE, snip } from './reach-shared';

export interface SearchItemsInput {
  query?: string;
  since?: string;
  until?: string;
  company?: string;
  topic?: string;
  limit: number;
}

interface Row {
  id: string;
  headline: string | null;
  summary: string | null;
  source_domain: string | null;
  published_date: string | null;
  label: string | null;
  rank: number;
}

const TSV = "(setweight(to_tsvector('english', coalesce(headline,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B'))";

export const searchItemsTool: AtlasTool<SearchItemsInput> = {
  name: 'search_items',
  description:
    'Filtered search over collected news items: the external scan (topic sweeps) and company intelligence items (tracked companies). Filter by date range, company slug, or scan topic; with a query, results are ranked by text relevance, otherwise newest first. Use for "what was published about X in March" or "latest items for company Y". Returns items labeled with citation tags.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional search terms, plain words. Terms are OR-combined; items matching more of them rank first.' },
      since: { type: 'string', description: 'Optional earliest publish date, YYYY-MM-DD.' },
      until: { type: 'string', description: 'Optional latest publish date, YYYY-MM-DD.' },
      company: { type: 'string', description: 'Optional tracked-company slug (for example "ally"). Limits results to that company\'s intel items.' },
      topic: { type: 'string', description: 'Optional external-scan topic slug. Limits results to scan items on that topic.' },
      limit: { type: 'integer', description: 'Max items, 1 to 15, default 8.' },
    },
    required: [],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    if (!isObj(input)) return 'Input must be an object.';
    const query = optText(input.query, 'query', 300);
    if (isErr(query)) return query.error;
    const since = parseDate(input.since, 'since');
    if (isErr(since)) return since.error;
    const until = parseDate(input.until, 'until');
    if (isErr(until)) return until.error;
    const c = optText(input.company, 'company', 64);
    if (isErr(c)) return c.error;
    const t = optText(input.topic, 'topic', 64);
    if (isErr(t)) return t.error;
    const company = c?.toLowerCase();
    const topic = t?.toLowerCase();
    if (company && !SLUG_RE.test(company)) return 'company must be a slug like "ally".';
    if (topic && !SLUG_RE.test(topic)) return 'topic must be a topic slug.';
    if (company && topic) return 'Give company or topic, not both: company filters intel items, topic filters scan items.';
    return { query, since, until, company, topic, limit: parseLimit(input.limit, 8, 15) };
  },
  async run(p, ctx) {
    ctx.status?.(p.query ? `Searching items for "${snip(p.query, 40)}"` : 'Listing recent items');
    const lim = p.limit;
    const build = (kind: 'scan' | 'intel') => {
      const params: unknown[] = [];
      const where: string[] = [];
      let rank = '0';
      if (p.query) {
        params.push(p.query);
        where.push(`${TSV} @@ ${ORQ}`);
        rank = `ts_rank(${TSV}, ${ORQ}, 1)`;
      }
      if (p.since) { params.push(p.since); where.push(`published_date >= $${params.length}::date`); }
      if (p.until) { params.push(p.until); where.push(`published_date <= $${params.length}::date`); }
      if (kind === 'scan' && p.topic) { params.push(p.topic); where.push(`topic_slug = $${params.length}`); }
      if (kind === 'intel' && p.company) { params.push(p.company); where.push(`company_slug = $${params.length}`); }
      const label = kind === 'scan' ? 'topic_slug' : 'company_slug';
      const table = kind === 'scan' ? 'scan_items' : 'intel_items';
      const sql = `select id::text as id, headline, summary, source_domain,
                          to_char(published_date, 'YYYY-MM-DD') as published_date, ${label} as label, (${rank})::float8 as rank
                     from ${table}
                    ${where.length ? `where ${where.join(' and ')}` : ''}
                    order by ${p.query ? 'rank desc, ' : ''}published_date desc nulls last
                    limit ${lim}`;
      return { sql, params };
    };
    const legs: ('scan' | 'intel')[] = p.company ? ['intel'] : p.topic ? ['scan'] : ['scan', 'intel'];
    const results = await Promise.all(
      legs.map(async (k) => {
        const { sql, params } = build(k);
        return (await q<Row>(sql, params)).map((r) => ({ ...r, kind: k }));
      })
    );
    const rows = results.flat();
    rows.sort((a, b) =>
      p.query && b.rank !== a.rank ? b.rank - a.rank : (b.published_date ?? '').localeCompare(a.published_date ?? '')
    );
    const top = rows.slice(0, lim);
    if (!top.length) return { text: 'No items matched those filters. Loosen the dates, drop the topic or company, or try other words.' };
    const lines = top.map((r) => {
      const tag = ctx.tagger.itemTagFor(`${r.kind}:${r.id}`);
      const bits = [r.kind === 'intel' ? `company ${r.label ?? '?'}` : r.label ? `topic ${r.label}` : 'scan', r.source_domain, r.published_date].filter(Boolean).join(', ');
      return `${citeToken('item', tag)} "${snip(r.headline ?? 'Untitled', 150)}" (${bits}): ${snip(r.summary, 220)}`;
    });
    return { text: clipLines([`${top.length} item${top.length === 1 ? '' : 's'}${p.query ? ', best match first' : ', newest first'}:`, ...lines]) };
  },
};

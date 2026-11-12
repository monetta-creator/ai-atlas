// startups: Startup Scout companies by space or vertical. Admin only: the
// verdict and pursue fields disclose acquisition intent and never reach guests
// or keyholders.
import { q } from '../db';
import { asObj, capText, clampInt, clip, likeEsc, optStr } from './util-b';
import type { AtlasTool } from './types';

interface In { query: string; limit: number }

interface Row {
  id: string; name: string; vertical: string; one_liner: string | null; ai_tech: string | null;
  stage: string; funding_note: string | null; founded_year: number | null; hq: string | null; url: string | null;
  status: string; agent_verdict: string | null; agent_reason: string | null; agent_confidence: number | null;
  review_note: string | null; created_at: Date | string;
}

export const startupsTool: AtlasTool<In> = {
  name: 'startups',
  description:
    'Admin only. Search Startup Scout companies by space, vertical or keyword (name, vertical, one-liner, AI technique). Returns name, vertical, stage, funding note, founding year, HQ, tracking status, and the scoring agent\'s verdict (pursue, watch, pass) with its reason. Rows are labeled [startup id] with the company id. fetch_record does not open startups yet.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A space, vertical or keyword, plain words.' },
      limit: { type: 'integer', description: 'Max companies, 1 to 15, default 8.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  scopes: ['admin'],
  parse(input) {
    const o = asObj(input);
    const query = o ? optStr(o.query, 120) : undefined;
    if (!query) return 'query is required: a space or vertical.';
    return { query, limit: clampInt(o?.limit, 1, 15, 8) };
  },
  async run(p, ctx) {
    ctx.status?.(`Searching Scout for ${clip(p.query, 40)}`);
    const terms = p.query.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 5) ?? [];
    if (!terms.length) return { text: 'Give at least one search word.', isError: true };
    const pats = terms.map((t) => `%${likeEsc(t)}%`);
    const rows = await q<Row>(
      `select id::text as id, name, vertical, one_liner, ai_tech, stage::text as stage, funding_note, founded_year, hq, url,
              status::text as status, agent_verdict::text as agent_verdict, agent_reason, agent_confidence, review_note, created_at
         from companies
        where status in ('tracked', 'queued')
          and exists (select 1 from unnest($1::text[]) pat
                       where name ilike pat or vertical ilike pat or one_liner ilike pat or ai_tech ilike pat)
        order by (status = 'tracked') desc, (agent_verdict = 'pursue') desc, (agent_verdict = 'watch') desc, name
        limit ${p.limit}`,
      [pats]
    );
    if (!rows.length) return { text: `No tracked or queued startups match "${p.query}".` };
    const lines = [`${rows.length} startup${rows.length === 1 ? '' : 's'} for "${p.query}":`];
    for (const r of rows) {
      const bits = [
        `vertical ${r.vertical}`,
        `stage ${r.stage}`,
        r.funding_note ? `funding ${clip(r.funding_note, 60)}` : null,
        r.founded_year ? `founded ${r.founded_year}` : null,
        r.hq ? `HQ ${clip(r.hq, 40)}` : null,
        `status ${r.status}`,
        r.url,
      ].filter(Boolean);
      lines.push(`- [startup ${r.id}] ${clip(r.name, 60)}: ${clip(r.one_liner, 130)} (${bits.join('; ')})`);
      if (r.agent_verdict || r.review_note) {
        lines.push(`  verdict ${r.agent_verdict ?? '–'}${r.agent_confidence != null ? ` (confidence ${r.agent_confidence})` : ''}${r.agent_reason ? `: ${clip(r.agent_reason, 170)}` : ''}${r.review_note ? `; review note: ${clip(r.review_note, 100)}` : ''}`);
      }
    }
    return { text: capText(lines) };
  },
};

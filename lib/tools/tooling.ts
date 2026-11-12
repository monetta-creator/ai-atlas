// tooling: search the Tooling Monitor catalog. Keyholders get the public
// catalog (cataloged only) and none of the agent/curation fields; admin also
// gets parked and candidate rows and the agent read.
import { q } from '../db';
import { asObj, capText, clampInt, clip, optStr, ymd } from './util-b';
import type { AtlasTool } from './types';

export interface ToolingInput { query: string; category?: string; limit: number }

export interface ToolingRow {
  slug: string; name: string; vendor: string | null; category: string | null; one_liner: string | null;
  deployment: string[] | null; pricing_model: string | null; compliance_claims: string[] | null;
  url: string | null; last_seen: Date | string | null; status: string;
  agent_fit?: number | null; agent_scores?: unknown; agent_reason?: string | null; review_note?: string | null; pinned?: boolean;
}

// The one tooling query (shared by the text tool and show_view). Keyholders get
// cataloged rows and none of the agent/curation columns. Null = no usable terms.
export async function queryTooling(p: ToolingInput, admin: boolean): Promise<ToolingRow[] | null> {
  const terms = p.query.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 8) ?? [];
  if (!terms.length) return null;
  const adminCols = admin ? ', agent_fit, agent_scores, agent_reason, review_note, pinned' : '';
  return q<ToolingRow>(
    `select slug, name, vendor, category, one_liner, deployment, pricing_model, compliance_claims, url,
            last_seen, status::text as status${adminCols}
       from tooling_products
      where search_tsv @@ to_tsquery('english', $1)
        and ${admin ? `status <> 'dismissed'` : `status = 'cataloged'`}
        and ($2::text is null or lower(category) = lower($2))
      order by ts_rank(search_tsv, to_tsquery('english', $1)) desc, name
      limit ${Math.max(1, Math.min(60, Math.floor(p.limit)))}`,
    [terms.join(' | '), p.category ?? null]
  );
}

export const toolingTool: AtlasTool<ToolingInput> = {
  name: 'tooling',
  description:
    'Search the Tooling Monitor catalog of AI tools and vendors by plain words, optionally within one category. Returns name, vendor, category, one-liner, deployment, pricing model, compliance claims, URL and last seen date. Admin callers also get the agent fit read. Rows are labeled [tool slug] for the reader to cite; fetch_record does not open tools yet, so rely on this result for product facts.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search terms, plain words.' },
      category: { type: 'string', description: 'Optional category name to restrict to (matched case-insensitively).' },
      limit: { type: 'integer', description: 'Max products, 1 to 15, default 8.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    const o = asObj(input);
    const query = o ? optStr(o.query, 200) : undefined;
    if (!query) return 'query is required: plain search words.';
    return { query, category: optStr(o?.category, 80), limit: clampInt(o?.limit, 1, 15, 8) };
  },
  async run(p, ctx) {
    const admin = ctx.identity.kind === 'admin';
    ctx.status?.(`Searching the tooling catalog for ${clip(p.query, 40)}`);
    const rows = await queryTooling(p, admin);
    if (!rows) return { text: 'Give at least one search word.', isError: true };
    if (!rows.length) return { text: `No tooling products match "${p.query}"${p.category ? ` in ${p.category}` : ''}.` };
    const lines = [`${rows.length} tooling product${rows.length === 1 ? '' : 's'} for "${p.query}":`];
    for (const r of rows) {
      const bits = [
        r.vendor ? `vendor ${clip(r.vendor, 40)}` : null,
        r.category ? `category ${clip(r.category, 40)}` : null,
        r.deployment?.length ? `deployment ${r.deployment.slice(0, 4).join('/')}` : null,
        r.pricing_model ? `pricing ${clip(r.pricing_model, 40)}` : null,
        r.compliance_claims?.length ? `compliance ${r.compliance_claims.slice(0, 5).join(', ')}` : null,
        r.url ? r.url : null,
        `last seen ${ymd(r.last_seen)}`,
        admin ? `status ${r.status}` : null,
      ].filter(Boolean);
      lines.push(`- [tool ${r.slug}] ${clip(r.name, 60)}: ${clip(r.one_liner, 140)} (${bits.join('; ')})`);
      if (admin && (r.agent_fit != null || r.agent_reason || r.review_note || r.pinned)) {
        const sc = r.agent_scores ? ` scores ${clip(JSON.stringify(r.agent_scores), 120)}` : '';
        lines.push(`  agent (admin only): fit ${r.agent_fit ?? '–'}${sc}${r.agent_reason ? `; ${clip(r.agent_reason, 160)}` : ''}${r.review_note ? `; review note: ${clip(r.review_note, 100)}` : ''}${r.pinned ? '; pinned' : ''}`);
      }
    }
    return { text: capText(lines) };
  },
};

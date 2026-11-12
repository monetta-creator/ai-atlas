// Our own web_search tool for open-weight models (Claude uses Anthropic's
// server-side web_search instead). Tavily-backed, the account every engine
// already pays for; logged as a $0 `tavily-search` row so the quota tile
// counts it. Results come back as numbered snippets the model attributes in
// prose by outlet, plus web sources for the client's sources strip.
import { recordApiCall } from '../cost';
import { tavilyAvailable, tavilyQuery } from '../scan/search-tavily';
import type { AtlasTool, ToolContext } from './types';
import type { WebSource } from '../llm/types';

export interface WebToolContext extends ToolContext {
  webSources?: (s: WebSource[]) => void;
}

export const webSearchTool: AtlasTool<{ query: string }> = {
  name: 'web_search',
  description:
    'Search the live web for current news and pages. Use after the Atlas tools when a recent development or an outside figure would sharpen the answer, or when the records leave a gap. Attribute what you use in prose by naming the outlet.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A focused search query.' } },
    required: ['query'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(v) {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const query = typeof o.query === 'string' ? o.query.trim().slice(0, 300) : '';
    return query ? { query } : 'web_search needs a non-empty query.';
  },
  async run(p, ctx: WebToolContext) {
    if (!tavilyAvailable()) return { text: 'Web search is unavailable right now (search quota). Answer from the Atlas records.', isError: true };
    const t0 = Date.now();
    const results = await tavilyQuery({ query: p.query, topic: 'general', maxResults: 6 });
    await recordApiCall({ feature: 'ask_answer', model: 'tavily-search', usage: null, wallMs: Date.now() - t0, metadata: { web_search: true } });
    const rows = results.filter((r) => r.url).slice(0, 6);
    ctx.webSources?.(rows.map((r) => ({ url: r.url!, title: r.title ?? r.url! })));
    ctx.status?.(`Searched the web: ${p.query}`);
    if (!rows.length) return { text: 'No web results.' };
    return {
      text: rows
        .map((r, i) => `(${i + 1}) ${r.title ?? ''} | ${r.url}${r.published_date ? ` | ${r.published_date.slice(0, 10)}` : ''}\n${(r.content ?? '').slice(0, 700)}`)
        .join('\n\n'),
    };
  },
};

// The one tool registry. toolsFor(identity) is the ONLY way a loop gets its
// tool list, so a keyholder can never be handed an admin-only tool, and
// runTool re-checks scope at call time (a model naming a tool it was not
// given gets an is_error result, never a run).
import { fetchRecordTool, searchArticlesTool, searchAtlasTool } from './atlas';
import { companyTool } from './company';
import { engineStatusTool } from './engine_status';
import { metricsTool } from './metrics';
import { questionMapTool } from './question_map';
import { reportTool } from './report';
import { searchItemsTool } from './search_items';
import { startupsTool } from './startups';
import { timelineTool } from './timeline';
import { toolingTool } from './tooling';
import { whatsNewTool } from './whats_new';
import { scopeOf, type AtlasTool, type Identity, type ToolContext, type ToolResult } from './types';

// 13 tools (Phase 3 reach). Under the ~15 where tool search (defer_loading)
// starts to pay; revisit when the list grows (P3.11).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: AtlasTool<any>[] = [
  searchAtlasTool, fetchRecordTool, searchArticlesTool,
  whatsNewTool, searchItemsTool, timelineTool, companyTool, metricsTool,
  questionMapTool, reportTool, toolingTool, startupsTool, engineStatusTool,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toolsFor(identity: Identity): AtlasTool<any>[] {
  const s = scopeOf(identity);
  return TOOLS.filter((t) => t.scopes.includes(s));
}

export function getTool(name: string) {
  return TOOLS.find((t) => t.name === name) ?? null;
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool || !tool.scopes.includes(scopeOf(ctx.identity))) return { text: `Unknown tool ${name}.`, isError: true };
  const parsed = tool.parse(input);
  if (typeof parsed === 'string') return { text: parsed, isError: true };
  try {
    return await tool.run(parsed, ctx);
  } catch (e) {
    return { text: `The ${name} tool failed: ${(e as Error).message.slice(0, 200)}. Try a different query or tool.`, isError: true };
  }
}

// Provider shapes.
export function anthropicTools(identity: Identity) {
  return toolsFor(identity).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

export function openaiTools(identity: Identity) {
  return toolsFor(identity).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

// The loop's provider-neutral ToolSpec list.
export function toolSpecs(identity: Identity): { name: string; description: string; inputSchema: object }[] {
  return toolsFor(identity).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

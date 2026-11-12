// The one tool registry. toolsFor(identity) is the ONLY way a loop gets its
// tool list, so a keyholder can never be handed an admin-only tool, and
// runTool re-checks scope at call time (a model naming a tool it was not
// given gets an is_error result, never a run).
import { fetchRecordTool, searchArticlesTool, searchAtlasTool } from './atlas';
import { scopeOf, type AtlasTool, type Identity, type ToolContext, type ToolResult } from './types';

// Later phases append here (whats_new, company, metrics, ...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: AtlasTool<any>[] = [searchAtlasTool, fetchRecordTool, searchArticlesTool];

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

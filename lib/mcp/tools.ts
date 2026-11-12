// The Atlas tool registry, seen through MCP (redo Phase 2). The transport is
// stateless (every tools/call is its own HTTP request, possibly on another
// serverless instance), so the conversation-scoped tag map cannot live in
// memory. Instead each result ends with a REFS line mapping its tags to
// record ids, and fetch_record takes that id back as `ref`. Same scopes as
// every other loop: toolsFor(identity).
import { createTagger } from '../ask/deep';
import { runTool, toolsFor } from '../tools/registry';
import type { Identity } from '../tools/types';

const TAGGED = /^[SPIXRH]\d{1,4}$/i;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function mcpTools(identity: Identity): McpToolDef[] {
  // show_view needs a client to draw into; the MCP door has none.
  return toolsFor(identity).filter((t) => t.name !== 'show_view').map((t) => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema)) as { properties: Record<string, unknown> };
    let description = t.description;
    if (t.name === 'fetch_record') {
      schema.properties.ref = {
        type: 'string',
        description: 'For a tag (S3, P4, I3, X31, R7, H3): the value shown for that tag in the REFS line of the result where you saw it.',
      };
      description += ' Tags only resolve with their ref from the REFS line of an earlier result.';
    }
    return { name: t.name, description, inputSchema: schema };
  });
}

export async function callMcpTool(identity: Identity, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { ref, ...input } = args ?? {};
  const seed: Record<string, string> = {};
  const id = typeof input.id === 'string' ? input.id.trim().toUpperCase() : '';
  if (name === 'fetch_record' && TAGGED.test(id)) {
    if (typeof ref !== 'string' || !ref.trim()) {
      return { text: `Pass the ref for ${id} from the REFS line of the result where it appeared.`, isError: true };
    }
    seed[id] = ref.trim();
  }
  const tagger = createTagger(seed, 0);
  const r = await runTool(name, input, { identity, tagger });
  const refs = tagger.refs().filter((x) => !(x.tag in seed));
  const refLine = refs.length ? `\n\nREFS (pass the value as ref to fetch_record): ${JSON.stringify(Object.fromEntries(refs.map((x) => [x.tag, x.id])))}` : '';
  return { text: r.text + refLine, isError: Boolean(r.isError) };
}

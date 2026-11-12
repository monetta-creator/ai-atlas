import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpIdentity } from '@/lib/mcp/auth';
import { callMcpTool, mcpTools } from '@/lib/mcp/tools';
import type { Identity } from '@/lib/tools/types';

// The MCP door (redo Phase 2): the Atlas tool registry as a remote MCP server
// over Streamable HTTP, stateless (no session id; every POST carries one
// JSON-RPC exchange and builds its own Server + transport). Identity from the
// bearer token (lib/mcp/auth.ts): the admin token or a portal access key;
// keyholders get exactly the keyholder-scoped tools. Allow-listed in the
// proxy (no atlas_* cookie on an MCP client) and gated here.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function buildServer(identity: Identity): Server {
  const server = new Server(
    { name: 'the-ai-atlas', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'The AI Atlas: a curated, dated record of the AI economy (news, filings, research papers, company facts) placed on an argument map of open questions, claims and stances. Search first, then fetch the records that matter, and cite them by the bracketed IDs the results show.',
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools(identity) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await callMcpTool(identity, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: 'text', text: r.text }], isError: r.isError };
  });
  return server;
}

async function handle(req: Request): Promise<Response> {
  const identity = await mcpIdentity(req);
  if (!identity) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: send Authorization: Bearer <token>.' }, id: null }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
    });
  }
  const server = buildServer(identity);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: nothing outlives the request.
    void server.close();
  }
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

// Stateless servers have no server-initiated stream and no session to end.
export async function GET(): Promise<Response> {
  return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
}

export async function DELETE(): Promise<Response> {
  return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
}

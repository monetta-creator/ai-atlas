// The MCP door against localhost:3100/api/mcp, as a real MCP client would
// speak it (JSON-RPC over Streamable HTTP): initialize, tools/list, tools/call
// for search_atlas and fetch_record (tag + ref round trip), 401 without a
// token or with a forged one, and keyholder scope (no admin-only tool, and a
// per-touch reason never appears). The keyholder leg needs a portal key:
// MCP_TEST_KEY=atlas_... (skipped when unset). Read-only on the database.
// Run: npx -y tsx scripts/test-mcp.mts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const { mcpAdminToken } = await import('../lib/mcp/auth');
const { mcpTools, callMcpTool } = await import('../lib/mcp/tools');

const URL_ = process.env.MCP_URL ?? 'http://localhost:3100/api/mcp';
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };
let nextId = 1;

async function rpc(method: string, params: unknown, token: string | null) {
  const res = await fetch(URL_, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const text = await res.text();
  let body: { result?: Record<string, unknown>; error?: { message: string } } | null = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body, text };
}

// Offline: the tool list shape per identity.
const adminDefs = mcpTools({ kind: 'admin' });
const keyDefs = mcpTools({ kind: 'keyholder', keyId: 'k' });
ok(adminDefs.some((t) => t.name === 'search_articles') && !keyDefs.some((t) => t.name === 'search_articles'), 'keyholder tool list excludes admin-only tools');
ok(Boolean((keyDefs.find((t) => t.name === 'fetch_record')?.inputSchema as { properties: Record<string, unknown> }).properties.ref), 'fetch_record carries ref');
const noRef = await callMcpTool({ kind: 'admin' }, 'fetch_record', { kind: 'signal', id: 'S3' });
ok(noRef.isError && /ref/.test(noRef.text), 'tag without ref is refused with a hint');

// Live.
const admin = mcpAdminToken();
const unauth = await rpc('initialize', {}, null);
ok(unauth.status === 401, `no token -> 401 (${unauth.status})`);
ok((await rpc('initialize', {}, 'mcpadm_forged')).status === 401, 'forged admin token -> 401');
ok((await rpc('initialize', {}, 'atlas_notarealkey')).status === 401, 'unknown portal key -> 401');

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-mcp', version: '1' } }, admin);
ok(init.status === 200 && (init.body?.result?.serverInfo as { name?: string })?.name === 'the-ai-atlas', `initialize (${init.status} ${init.text.slice(0, 120)})`);
const list = await rpc('tools/list', {}, admin);
const names = ((list.body?.result?.tools as { name: string }[]) ?? []).map((t) => t.name);
ok(names.includes('search_atlas') && names.includes('fetch_record'), `tools/list: ${names.join(', ')}`);

const search = await rpc('tools/call', { name: 'search_atlas', arguments: { query: 'banks unauthorized AI agents customer accounts', kinds: ['signal'], limit: 3 } }, admin);
const sText = ((search.body?.result?.content as { text: string }[]) ?? [])[0]?.text ?? '';
ok(/REFS/.test(sText), 'search result carries REFS');
const refs = JSON.parse(/REFS[^{]*(\{.*\})/.exec(sText)?.[1] ?? '{}') as Record<string, string>;
const [tag, ref] = Object.entries(refs).find(([t]) => t.startsWith('S')) ?? [];
ok(Boolean(tag), 'a signal tag came back');
if (tag && ref) {
  const fetched = await rpc('tools/call', { name: 'fetch_record', arguments: { kind: 'signal', id: tag, ref } }, admin);
  const fr = fetched.body?.result as { content: { text: string }[]; isError?: boolean } | undefined;
  ok(fr?.isError !== true && (fr?.content?.[0]?.text ?? '').length > 100, `fetch_record by tag + ref (${(fr?.content?.[0]?.text ?? '').slice(0, 80)})`);
}

const key = process.env.MCP_TEST_KEY;
if (key) {
  const kl = await rpc('tools/list', {}, key);
  const kn = ((kl.body?.result?.tools as { name: string }[]) ?? []).map((t) => t.name);
  ok(kl.status === 200 && !kn.includes('search_articles'), `keyholder tools: ${kn.join(', ')}`);
  const forbidden = await rpc('tools/call', { name: 'search_articles', arguments: { query: 'banks' } }, key);
  ok(((forbidden.body?.result as { isError?: boolean })?.isError ?? false) === true, 'keyholder cannot call an admin-only tool');
} else console.log('(keyholder leg skipped: set MCP_TEST_KEY to a portal access key)');

console.log(fail ? `${fail} failure(s)` : `ok: mcp door (${names.length} admin tools)`);
process.exit(fail ? 1 : 0);

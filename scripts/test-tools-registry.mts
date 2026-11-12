// Tool registry tests: schema discipline, scope filtering, call-time scope
// re-check, and keyholder safety on live (read-only) records: a keyholder
// never sees a signal's per-touch reason, never resolves a draft signal, and
// never gets the admin-only article search.
// Run: npx -y tsx scripts/test-tools-registry.mts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const { TOOLS, toolsFor, runTool, anthropicTools, openaiTools } = await import('../lib/tools/registry');
const { createTagger } = await import('../lib/ask/deep');
const { one } = await import('../lib/db');

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

// 1. Schema discipline: every object closed, no integer min/max.
function walk(schema: unknown, path: string) {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') ok(s.additionalProperties === false, `${path}: additionalProperties:false`);
  if (s.type === 'integer') ok(!('minimum' in s) && !('maximum' in s), `${path}: no integer min/max`);
  for (const [k, v] of Object.entries(s)) if (v && typeof v === 'object') walk(v, `${path}.${k}`);
}
for (const t of TOOLS) {
  walk(t.inputSchema, t.name);
  ok(/^[a-z_]{3,40}$/.test(t.name), `${t.name}: name shape`);
  ok(t.scopes.length > 0, `${t.name}: has a scope`);
  ok(!/—/.test(t.description), `${t.name}: no em dash`);
}
ok(new Set(TOOLS.map((t) => t.name)).size === TOOLS.length, 'unique names');

// 2. Scope filtering.
const admin = { kind: 'admin' as const };
const key = { kind: 'keyholder' as const, keyId: 'test' };
const adminNames = toolsFor(admin).map((t) => t.name);
const keyNames = toolsFor(key).map((t) => t.name);
ok(adminNames.includes('search_articles'), 'admin gets search_articles');
ok(!keyNames.includes('search_articles'), 'keyholder never gets search_articles');
ok(keyNames.includes('search_atlas') && keyNames.includes('fetch_record'), 'keyholder gets search + fetch');
ok(anthropicTools(key).length === keyNames.length && openaiTools(key)[0].type === 'function', 'provider shapes');

// 3. Call-time re-check and parse errors.
const tagger = createTagger({}, 0);
const r1 = await runTool('search_articles', { query: 'banks' }, { identity: key, tagger });
ok(r1.isError === true && /Unknown tool/.test(r1.text), 'keyholder cannot run admin-only tool by name');
const r2 = await runTool('search_atlas', { query: '' }, { identity: admin, tagger });
ok(r2.isError === true, 'empty query -> is_error');
const r3 = await runTool('nope', {}, { identity: admin, tagger });
ok(r3.isError === true, 'unknown tool -> is_error');

// 4. Live keyholder safety on records.
const sig = await one<{ id: string; reason: string }>(
  `select id, (select value->>'reason' from jsonb_each(touch_details) limit 1) as reason
     from signals where is_published and archived_at is null and touch_details <> '{}'::jsonb
    order by published_at desc limit 1`,
);
if (sig?.reason) {
  const kt = createTagger({ S1: sig.id }, 1);
  const kr = await runTool('fetch_record', { kind: 'signal', id: 'S1' }, { identity: key, tagger: kt });
  ok(!kr.isError, `keyholder can read a published signal (${kr.text.slice(0, 80)})`);
  ok(!kr.text.includes(sig.reason.slice(0, 60)), 'keyholder never sees the per-touch reason');
}
const draft = await one<{ id: string }>(`select id from signals where not is_published and archived_at is null limit 1`);
if (draft) {
  const dt = createTagger({ S1: draft.id }, 1);
  const kd = await runTool('fetch_record', { kind: 'signal', id: 'S1' }, { identity: key, tagger: dt });
  ok(kd.isError === true, 'keyholder cannot resolve a draft signal');
  const ad = await runTool('fetch_record', { kind: 'signal', id: 'S1' }, { identity: admin, tagger: createTagger({ S1: draft.id }, 1) });
  ok(!ad.isError, 'admin can resolve a draft signal');
}
const ks = await runTool('search_atlas', { query: 'banks AI agents customer accounts', limit: 3 }, { identity: key, tagger: createTagger({}, 0) });
ok(!ks.isError && /\[(claim|bridge|stance|S\d|P\d|I\d|X\d|R\d|H\d)/.test(ks.text), 'keyholder search returns tagged records');

console.log(fail ? `${fail} failure(s)` : `ok: ${TOOLS.length} tools, admin ${adminNames.length}, keyholder ${keyNames.length}`);
process.exit(fail ? 1 : 0);

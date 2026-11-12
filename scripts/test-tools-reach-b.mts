// Reach-B research tools: question_map, whats_new, tooling, startups,
// engine_status, report. Read-only live calls against the database; no model
// calls. Run: npx -y tsx scripts/test-tools-reach-b.mts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const { q, one } = await import('../lib/db');
const { createTagger } = await import('../lib/ask/deep');
const { questionMapTool } = await import('../lib/tools/question_map');
const { whatsNewTool } = await import('../lib/tools/whats_new');
const { toolingTool } = await import('../lib/tools/tooling');
const { startupsTool } = await import('../lib/tools/startups');
const { engineStatusTool } = await import('../lib/tools/engine_status');
const { reportTool } = await import('../lib/tools/report');
import type { AtlasTool, Identity } from '../lib/tools/types';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } else console.log('ok  ', m); };
const admin: Identity = { kind: 'admin' };
const key: Identity = { kind: 'keyholder', keyId: 'test-key' };
const ctx = (identity: Identity) => ({ identity, tagger: createTagger({}, 0) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL: AtlasTool<any>[] = [questionMapTool, whatsNewTool, toolingTool, startupsTool, engineStatusTool, reportTool];

// Schema discipline.
function walk(n: unknown, path: string, bad: string[]) {
  if (!n || typeof n !== 'object') return;
  const o = n as Record<string, unknown>;
  if (o.type === 'object' && o.additionalProperties !== false) bad.push(`${path}: additionalProperties`);
  if ((o.type === 'integer' || o.type === 'number') && ('minimum' in o || 'maximum' in o)) bad.push(`${path}: min/max`);
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, bad);
}
for (const t of ALL) {
  const bad: string[] = [];
  walk(t.inputSchema, t.name, bad);
  ok(bad.length === 0, `${t.name} schema discipline ${bad.join(', ')}`);
  ok(!/—/.test(t.description), `${t.name} description has no em dash`);
}
ok(JSON.stringify(startupsTool.scopes) === '["admin"]' && JSON.stringify(engineStatusTool.scopes) === '["admin"]', 'startups and engine_status are admin only');

// Parse errors.
ok(typeof questionMapTool.parse({}) === 'string', 'question_map rejects empty');
ok(typeof whatsNewTool.parse({ since: 'yesterday' }) === 'string', 'whats_new rejects a bad date');
ok(typeof toolingTool.parse({}) === 'string', 'tooling rejects missing query');
ok(typeof startupsTool.parse({ query: '  ' }) === 'string', 'startups rejects blank query');
ok(typeof reportTool.parse({ kind: 'nope' }) === 'string', 'report rejects a bad kind');
ok((toolingTool.parse({ query: 'x', limit: 99 }) as { limit: number }).limit === 15, 'tooling clamps limit to 15');
ok((whatsNewTool.parse({ since: '2020-01-01' }) as { days: number }).days === 31, 'whats_new clamps to 31 days');

const timings: string[] = [];
async function call<I>(t: AtlasTool<I>, input: unknown, identity: Identity, label: string) {
  const parsed = t.parse(input);
  if (typeof parsed === 'string') throw new Error(`${label}: parse failed: ${parsed}`);
  const c = ctx(identity);
  const t0 = Date.now();
  const r = await t.run(parsed, c);
  const ms = Date.now() - t0;
  timings.push(`${label}: ${ms} ms${ms > 2000 ? '  (OVER 2 s)' : ''}`);
  ok(!r.isError && r.text.length > 0 && r.text.length < 5000, `${label}: non-empty, under 5000 chars (${r.text.length})`);
  return r.text;
}

// question_map
const qs = await q<{ slug: string }>(`select slug from questions order by sort_order limit 1`);
const qm = await call(questionMapTool, { question: qs[0].slug }, admin, 'question_map admin');
ok(/\[stance [^\]]+\]/.test(qm) && /\[claim [^\]]+\]/.test(qm), 'question_map labels stances and claims');
ok(/\((settled|leaning|contested|thin)/.test(qm), 'question_map admin sees confidence words');
const qmk = await call(questionMapTool, { question: qs[0].slug }, key, 'question_map keyholder');
ok(!/\((settled|leaning|contested|thin)/.test(qmk) && !/\b0\.\d\d\)/.test(qmk), 'question_map keyholder has no confidence words or values');
const aClaim = await one<{ code: string }>(`select code from claims where is_frame = false order by code limit 1`);
const byClaim = await call(questionMapTool, { question: aClaim!.code }, key, 'question_map by claim code');
ok(byClaim.includes(`[claim ${aClaim!.code}]`), 'question_map resolves a claim code to its question');
console.log('--- question_map sample ---\n' + qm.split('\n').slice(0, 15).join('\n'));

// whats_new
const wn = await call(whatsNewTool, { since: new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) }, admin, 'whats_new admin');
ok(/Signals:/.test(wn) && /Tooling first seen:/.test(wn), 'whats_new has engine groups');
ok(/\[(signal|paper|item|fact) [SPIX]\d+\]/.test(wn), 'whats_new carries tagged rows');
console.log('--- whats_new sample ---\n' + wn.split('\n').slice(0, 15).join('\n'));
const wnk = await call(whatsNewTool, { since: new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) }, key, 'whats_new keyholder');
const drafts = await q<{ title: string }>(`select title from signals where not is_published and char_length(title) > 20 order by created_at desc limit 10`);
ok(drafts.every((d) => !wnk.includes(d.title.slice(0, 40))), 'whats_new keyholder has no draft signal titles');
const reasons = await q<{ r: string }>(
  `select (v.value->>'reason') as r from signals s, jsonb_each(s.touch_details) v
    where s.is_published and s.touch_details is not null and char_length(v.value->>'reason') > 30 order by s.created_at desc limit 40`
);
ok(reasons.every((x) => !wnk.includes(x.r.slice(0, 40))), `whats_new keyholder has no touch_details reason text (checked ${reasons.length})`);

// tooling
const prod = await one<{ name: string; slug: string; agent_reason: string; review_note: string | null }>(
  `select name, slug, agent_reason, review_note from tooling_products
    where status = 'cataloged' and agent_reason is not null and char_length(agent_reason) > 30 order by agent_fit desc nulls last limit 1`
);
const word = prod!.name.split(/\s+/)[0];
const ta = await call(toolingTool, { query: word, limit: 15 }, admin, 'tooling admin');
ok(ta.includes(`[tool ${prod!.slug}]`) && ta.includes(prod!.agent_reason.slice(0, 40)), 'tooling admin sees the agent read');
const tk = await call(toolingTool, { query: word, limit: 15 }, key, 'tooling keyholder');
ok(tk.includes(`[tool ${prod!.slug}]`), 'tooling keyholder finds the product');
ok(!tk.includes(prod!.agent_reason.slice(0, 40)) && !/agent \(admin only\)|; pinned|review note:|\bfit \d|scores \{/.test(tk), 'tooling keyholder has no agent_reason or other admin-only fields');
const hidden = await q<{ slug: string }>(`select slug from tooling_products where status <> 'cataloged' limit 50`);
ok(hidden.every((h) => !tk.includes(`[tool ${h.slug}]`)), 'tooling keyholder sees only cataloged products');
console.log('--- tooling sample ---\n' + ta.split('\n').slice(0, 15).join('\n'));

// startups
const v = await one<{ vertical: string }>(`select vertical from companies where status in ('tracked','queued') limit 1`);
if (v) {
  const su = await call(startupsTool, { query: v.vertical.split(/[-_ ]/)[0] }, admin, 'startups admin');
  ok(/\[startup [0-9a-f-]+\]/.test(su), 'startups labeled');
  console.log('--- startups sample ---\n' + su.split('\n').slice(0, 15).join('\n'));
} else console.log('skip startups: no companies');

// engine_status
const es = await call(engineStatusTool, {}, admin, 'engine_status admin');
ok(/scan:/.test(es) && /Model spend/.test(es) && /Tavily/.test(es), 'engine_status has engines, spend, Tavily');
console.log('--- engine_status sample ---\n' + es.split('\n').slice(0, 15).join('\n'));

// report
for (const kind of ['edition', 'roundup', 'savant']) {
  const has = await one<{ n: number }>(`select count(*)::int as n from generated_reports where kind = $1::report_kind_t and is_published`, [kind]);
  if (!has?.n) { console.log(`skip report ${kind}: none published`); continue; }
  const rt = await call(reportTool, { kind }, key, `report ${kind} keyholder`);
  ok(/\[report R\d+\]/.test(rt), `report ${kind} tagged with R tags`);
  if (kind === 'savant') console.log('--- report sample ---\n' + rt.split('\n').slice(0, 15).join('\n'));
}

// runTool scope check via registry is the registrar's job; assert scopes only.
console.log('\nTimings:\n' + timings.join('\n'));
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

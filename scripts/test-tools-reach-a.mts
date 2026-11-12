// Tests for the four research-reach tools (search_items, company, metrics,
// timeline): parse errors, schema discipline, live read-only queries with
// timing, keyholder safety. SELECT only. Run: npx -y tsx scripts/test-tools-reach-a.mts
import { config } from 'dotenv';
config({ path: '.env.local' });

let fail = 0;
let pass = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else { fail++; console.error('FAIL', m); }
};

const { createTagger } = await import('../lib/ask/deep');
const { searchItemsTool } = await import('../lib/tools/search_items');
const { companyTool } = await import('../lib/tools/company');
const { metricsTool } = await import('../lib/tools/metrics');
const { timelineTool } = await import('../lib/tools/timeline');
const { q } = await import('../lib/db');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tool = import('../lib/tools/types').AtlasTool<any>;
type Ctx = import('../lib/tools/types').ToolContext;

const tools: Tool[] = [searchItemsTool, companyTool, metricsTool, timelineTool];
const mk = (kind: 'admin' | 'keyholder'): Ctx => ({
  identity: kind === 'admin' ? { kind: 'admin' } : { kind: 'keyholder', keyId: 'test' },
  tagger: createTagger({}, 0),
  status: () => {},
});

// Schema discipline.
const walk = (s: unknown, path: string) => {
  if (!s || typeof s !== 'object') return;
  const o = s as Record<string, unknown>;
  if (o.type === 'object') ok(o.additionalProperties === false, `${path}: object needs additionalProperties:false`);
  if (o.type === 'integer') ok(!('minimum' in o) && !('maximum' in o), `${path}: integer has min/max`);
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
};
for (const t of tools) {
  walk(t.inputSchema, t.name);
  ok(t.scopes.includes('admin') && t.scopes.includes('keyholder'), `${t.name} scopes`);
  ok(!/—/.test(JSON.stringify(t.inputSchema) + t.description), `${t.name} has an em dash`);
  ok(t.inputSchema.required.every((r) => r in t.inputSchema.properties), `${t.name} required keys exist`);
}

// Parse behavior.
const bad = (t: Tool, input: unknown, label: string) => ok(typeof t.parse(input) === 'string', `${t.name} parse rejects ${label}`);
bad(searchItemsTool, null, 'null');
bad(searchItemsTool, { since: '2026-13-40' }, 'bad since');
bad(searchItemsTool, { until: 'yesterday' }, 'bad until');
bad(searchItemsTool, { company: 'ally', topic: 'x' }, 'company+topic');
bad(searchItemsTool, { company: 'A B; drop' }, 'bad slug');
bad(searchItemsTool, { query: 5 }, 'non-string query');
{
  const r = searchItemsTool.parse({ limit: 999 });
  ok(typeof r !== 'string' && r.limit === 15, 'search_items clamps limit to 15');
  const r2 = searchItemsTool.parse({ limit: 0 });
  ok(typeof r2 !== 'string' && r2.limit === 1, 'search_items clamps limit up to 1');
  const r3 = searchItemsTool.parse({});
  ok(typeof r3 !== 'string' && r3.limit === 8, 'search_items default limit 8');
}
bad(companyTool, {}, 'missing company');
bad(companyTool, { company: '' }, 'empty company');
bad(metricsTool, {}, 'missing company');
bad(metricsTool, { company: 'ally', from: '2026-02-30' }, 'bad from');
bad(metricsTool, { company: 'bad slug!' }, 'bad slug');
{
  const r = metricsTool.parse({ company: 'Ally', limit: 500 });
  ok(typeof r !== 'string' && r.limit === 40 && r.company === 'ally', 'metrics clamps limit, lowercases slug');
}
bad(timelineTool, {}, 'missing topic');
bad(timelineTool, { topic: 'x', from: '2026-05-01', to: '2026-01-01' }, 'from after to');
bad(timelineTool, { topic: 'x', to: 'nope' }, 'bad to');

// Live queries.
const timed = async (label: string, t: Tool, input: unknown, ctx: Ctx) => {
  const parsed = t.parse(input);
  if (typeof parsed === 'string') { ok(false, `${label} parse: ${parsed}`); return { text: '', ms: 0 }; }
  const t0 = performance.now();
  const res = await t.run(parsed, ctx);
  const ms = Math.round(performance.now() - t0);
  console.log(`[${label}] ${ms} ms, ${res.text.length} chars`);
  ok(!res.isError, `${label} not an error`);
  ok(res.text.length > 0 && res.text.length < 5000, `${label} length ${res.text.length} in (0, 5000)`);
  ok(!/—/.test(res.text), `${label} output has an em dash`);
  if (ms > 2000) console.warn(`SLOW ${label}: ${ms} ms, needs an index check`);
  return { text: res.text, ms };
};

const sample = process.argv.includes('--sample');
const show = (label: string, text: string) => {
  if (sample) console.log(`--- ${label}\n${text.split('\n').slice(0, 15).join('\n')}\n---`);
};

const [co] = await q<{ slug: string; name: string }>(
  `select c.slug, c.name from intel_companies c
    where exists (select 1 from intel_facts f where f.company_slug = c.slug)
      and exists (select 1 from intel_metrics m where m.company_slug = c.slug)
    order by c.slug limit 1`
);
ok(!!co, 'found a company with facts and metrics');

for (const kind of ['admin', 'keyholder'] as const) {
  const ctx = mk(kind);

  const a = await timed(`search_items q ${kind}`, searchItemsTool, { query: 'AI agents bank', limit: 6 }, ctx);
  ok(/\[item I\d+\]/.test(a.text), 'search_items has item tags');
  show(`search_items ${kind}`, a.text);
  const b = await timed(`search_items filters ${kind}`, searchItemsTool, { since: '2026-01-01', company: co.slug, limit: 5 }, ctx);
  ok(/\[item I\d+\]/.test(b.text) || /No items matched/.test(b.text), 'search_items company filter renders');
  await timed(`search_items dateonly ${kind}`, searchItemsTool, { since: '2026-06-01', until: '2026-12-31' }, ctx);

  const c = await timed(`company ${kind}`, companyTool, { company: co.slug }, ctx);
  ok(/\[fact X\d+\]/.test(c.text), 'company has fact tags');
  ok(/\[item I\d+\]/.test(c.text), 'company has item tags');
  show(`company ${kind}`, c.text);
  const c2 = await timed(`company by name ${kind}`, companyTool, { company: co.name }, ctx);
  ok(c2.text.includes(`Company ${co.slug}`), 'company resolves by name');
  const c3 = await companyTool.run({ company: 'zzzz-no-such-co' }, ctx);
  ok(/No tracked company/.test(c3.text), 'company unknown handled');

  const m = await timed(`metrics noseries ${kind}`, metricsTool, { company: co.slug }, ctx);
  ok(/series \| period \| value/.test(m.text) && /Series available/.test(m.text), 'metrics table and series list');
  show(`metrics ${kind}`, m.text);
  const mrows = m.text.split('\n').filter((l) => / \| \d{4}-\d{2}-\d{2} \| /.test(l)).length;
  ok(mrows <= 40, 'metrics at most 40 rows');
  const m2 = await timed(`metrics series ${kind}`, metricsTool, { company: co.slug, series: 'deposits', from: '2020-01-01' }, ctx);
  ok(!/Series available/.test(m2.text) || /No metric rows/.test(m2.text), 'metrics with series skips the series list unless empty');
  const m3 = await metricsTool.run({ company: 'zzzz', limit: 5 }, ctx);
  ok(/No metric rows/.test(m3.text), 'metrics unknown company handled');

  const t1 = await timed(`timeline ${kind}`, timelineTool, { topic: 'AI regulation banks', from: '2025-01-01', to: '2026-12-31' }, ctx);
  ok(/\[(history H|signal S)\d+\]/.test(t1.text), 'timeline has tags');
  const trows = t1.text.split('\n').filter((l) => /^\[(history|signal) /.test(l));
  ok(trows.length <= 30, 'timeline at most 30 rows');
  const dates = trows.map((l) => l.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '');
  ok(dates.every((d, i) => i === 0 || dates[i - 1] <= d), 'timeline is date-ordered');
  show(`timeline ${kind}`, t1.text);
}

// Safety: keyholder (and admin) output never carries touch_details text, and
// timeline never names a draft signal.
{
  const [td] = await q<{ reason: string; title: string }>(
    `select (e.value->>'reason') as reason, s.title
       from signals s, lateral jsonb_each(s.touch_details) e
      where s.is_published and s.archived_at is null and jsonb_typeof(s.touch_details) = 'object'
        and length(coalesce(e.value->>'reason','')) > 60 limit 1`
  );
  const [draft] = await q<{ id: string; title: string }>(
    `select id::text as id, title from signals where not is_published and archived_at is null and length(title) > 25 order by created_at desc limit 1`
  );
  const ctx = mk('keyholder');
  const reasonProbe = td?.reason?.slice(0, 40);
  if (reasonProbe) {
    const words = td.title.match(/[A-Za-z]{4,}/g)?.slice(0, 6).join(' ') ?? 'AI';
    const r = await timelineTool.run({ topic: words }, ctx);
    ok(r.text.includes(td.title.slice(0, 30)), 'probe: timeline surfaced the signal whose reason is probed');
    ok(!r.text.includes(reasonProbe), 'keyholder timeline output omits touch_details reasons');
  } else console.log('note: no touch_details reason sample found; probe skipped');
  if (draft) {
    const words = draft.title.match(/[A-Za-z]{4,}/g)?.slice(0, 6).join(' ') ?? draft.title;
    const r = await timelineTool.run({ topic: words }, ctx);
    ok(!r.text.includes(draft.title), 'timeline omits draft signal titles');
    const rid = ctx.tagger.refs();
    const draftTagged = rid.some((x) => x.id === draft.id);
    ok(!draftTagged, 'timeline did not mint a tag for a draft signal');
  } else console.log('note: no draft signal found; probe skipped');
  // Every signal tag any timeline run minted must be a published, unarchived signal.
  const ctx2 = mk('keyholder');
  await timelineTool.run({ topic: 'AI agents banking regulation' }, ctx2);
  const sigIds = ctx2.tagger.refs().filter((x) => x.tag.startsWith('S')).map((x) => x.id);
  if (sigIds.length) {
    const [bad] = await q<{ n: number }>(
      `select count(*)::int as n from signals where id = any($1::uuid[]) and (not is_published or archived_at is not null)`,
      [sigIds]
    );
    ok(bad.n === 0, 'timeline signal tags are all published and unarchived');
  }
}

console.log(`${pass} passed, ${fail} failed`);
const pool = (globalThis as { __atlasPool?: { end(): Promise<void> } }).__atlasPool;
await pool?.end();
process.exit(fail ? 1 : 0);

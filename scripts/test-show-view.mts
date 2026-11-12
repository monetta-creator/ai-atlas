// show_view: schema discipline, parse refusals, and one live (read-only) call per
// source with a fake ctx.view: rows present, <= 60, every row cited, metrics
// chart numbers equal the database, keyholder tooling rows carry no admin fields.
// Run: npx -y tsx scripts/test-show-view.mts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const { showViewTool } = await import('../lib/tools/show_view');
const { createTagger } = await import('../lib/ask/deep');
const { q } = await import('../lib/db');
const { protocolProblems } = await import('../lib/ask/v2-events');
type AtlasView = import('../lib/tools/types').AtlasView;

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };

// Schema discipline: additionalProperties:false on every object, no integer min/max.
function walk(node: unknown, path: string) {
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.type === 'object') ok(o.additionalProperties === false, `${path}: additionalProperties:false`);
  if (o.type === 'integer') ok(o.minimum === undefined && o.maximum === undefined, `${path}: no min/max on integers`);
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
}
walk(showViewTool.inputSchema, 'show_view');
ok(showViewTool.scopes.includes('admin') && showViewTool.scopes.includes('keyholder'), 'scopes admin + keyholder');

// Parse refusals.
const bad = (i: unknown, re: RegExp, m: string) => { const r = showViewTool.parse(i); ok(typeof r === 'string' && re.test(r), `${m} (got ${JSON.stringify(r)})`); };
bad({ kind: 'chart', source: 'tooling', params: { query: 'x' } }, /only available for source metrics/, 'chart on tooling refused');
bad({ kind: 'chart', source: 'items', params: {} }, /only available for source metrics/, 'chart on items refused');
bad({ kind: 'timeline', source: 'metrics', params: { company: 'ally' } }, /timeline view is only/, 'timeline on metrics refused');
bad({ kind: 'timeline', source: 'tooling', params: { query: 'x' } }, /timeline view is only/, 'timeline on tooling refused');
bad({ kind: 'table', source: 'metrics', params: { query: 'x', company: 'ally' } }, /does not take query/, 'foreign param refused');
bad({ kind: 'table', source: 'metrics', params: {} }, /company is required/, 'metrics needs company');
bad({ kind: 'table', source: 'nope', params: {} }, /source must be/, 'unknown source');
bad({ kind: 'table', source: 'timeline', params: { topic: 'x', from: '2024-13-45' } }, /date/, 'bad date refused');
ok(typeof showViewTool.parse({ kind: 'chart', source: 'metrics', params: { company: 'ally' } }) !== 'string', 'chart on metrics parses');

// Event protocol still valid with a view between decision and cost.
const decision = { model: 'm', label: 'M', provider: 'anthropic', tier: 'cheap', auto: true, recommended: 'm', recommendedLabel: 'M', reason: '', web: false, clarify: false, depth: '2', estUsd: 0, budget: { notice: null, message: null, usedShare: 0 }, latencyMs: 1 } as const;
const cost = { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, searches: 0, rounds: 1, tool_calls: 1, model: 'm' };
ok(protocolProblems([
  { type: 'lane', lane: 'covered', reason: '' }, { type: 'decision', decision },
  { type: 'view', view: { kind: 'table', title: 't', rows: [] } },
  { type: 'delta', text: 'a' }, { type: 'cost', report: cost }, { type: 'done', signals: {} },
]).length === 0, 'view event keeps the protocol valid');

async function call(identity: { kind: 'admin' } | { kind: 'keyholder'; keyId: string }, input: unknown) {
  const views: AtlasView[] = [];
  const p = showViewTool.parse(input);
  if (typeof p === 'string') throw new Error(p);
  const res = await showViewTool.run(p, { identity, tagger: createTagger({}, 0), view: (v) => views.push(v) });
  return { views, res };
}
const admin = { kind: 'admin' } as const;
const keyholder = { kind: 'keyholder', keyId: 'test' } as const;

// Metrics: pick a company with data.
const co = await q<{ company_slug: string; metric_code: string }>(
  `select company_slug, metric_code from intel_metrics group by 1,2 having count(*) >= 3 order by count(*) desc limit 1`
);
ok(co.length === 1, 'a metrics series with >= 3 rows exists');
if (co[0]) {
  const { company_slug: company, metric_code: series } = co[0];
  for (const identity of [admin, keyholder]) {
    const { views, res } = await call(identity, { kind: 'chart', source: 'metrics', params: { company, series } });
    const v = views[0];
    ok(!!v && v.kind === 'chart', `${identity.kind} metrics chart emitted`);
    if (v) {
      ok(v.rows.length > 0 && v.rows.length <= 60, `metrics chart rows 1..60 (${v.rows.length})`);
      ok(v.rows.every((r) => typeof r.cite === 'string' && r.cite), 'every metrics row has a cite label');
      ok(v.x === 'period' && v.y === 'value' && v.series === 'series', 'chart axes bound to period/value/series');
      const db = await q<{ period: string; value: number }>(
        `select to_char(period,'YYYY-MM-DD') as period, value from intel_metrics where company_slug=$1 and metric_code=$2`, [company, series]
      );
      const dbMap = new Map(db.map((d) => [d.period, Number(d.value)]));
      ok(v.rows.every((r) => dbMap.get(String(r.period)) === Number(r.value)), 'every chart value equals the database value');
      ok(/Shown to the reader: a chart of \d+ rows/.test(res.text), 'summary note names the view');
    }
  }
  const t = await call(admin, { kind: 'table', source: 'metrics', params: { company } });
  ok(t.views[0]?.kind === 'table' && t.views[0].rows.length > 0, 'metrics table emitted');
}

// Tooling.
const tk = await call(keyholder, { kind: 'table', source: 'tooling', params: { query: 'agent' } });
const ta = await call(admin, { kind: 'table', source: 'tooling', params: { query: 'agent' } });
for (const [who, r] of [['keyholder', tk], ['admin', ta]] as const) {
  const v = r.views[0];
  ok(!!v && v.rows.length > 0 && v.rows.length <= 60, `${who} tooling rows present (${v?.rows.length})`);
  if (v) {
    ok(v.rows.every((x) => typeof x.cite === 'string' && /^\[tool [^\]]+\]$/.test(String(x.cite))), `${who} tooling rows cite [tool slug]`);
    const keys = new Set(v.rows.flatMap((x) => Object.keys(x)));
    ok(!['agent_fit', 'agent_scores', 'agent_reason', 'review_note', 'pinned', 'status'].some((k) => keys.has(k)), `${who} tooling rows carry no agent/curation fields`);
    ok(!/agent \(admin only\)|review note/.test(r.res.text), `${who} summary has no admin-only text`);
  }
}
// Keyholder rows are a subset of the cataloged set.
if (tk.views[0]) {
  const slugs = tk.views[0].rows.map((x) => String(x.cite).slice(6, -1));
  const bad2 = await q<{ slug: string }>(`select slug from tooling_products where slug = any($1) and status <> 'cataloged'`, [slugs]);
  ok(bad2.length === 0, 'keyholder tooling rows are all cataloged');
}

// Items (table + timeline) and timeline source.
const it = await call(admin, { kind: 'table', source: 'items', params: { query: 'bank' } });
ok(!!it.views[0] && it.views[0].rows.length > 0 && it.views[0].rows.length <= 60, `items table rows (${it.views[0]?.rows.length})`);
ok(!!it.views[0] && it.views[0].rows.every((r) => /^\[item I\d+\]$/.test(String(r.cite))), 'items rows carry [item In] tags');
const itl = await call(admin, { kind: 'timeline', source: 'items', params: { query: 'bank' } });
const dates = itl.views[0]?.rows.map((r) => String(r.date ?? '')) ?? [];
ok(itl.views[0]?.kind === 'timeline' && dates.join() === dates.slice().sort().join(), 'items timeline sorted oldest first');
const tl = await call(admin, { kind: 'timeline', source: 'timeline', params: { topic: 'bank' } });
ok(!!tl.views[0] && tl.views[0].rows.length > 0 && tl.views[0].rows.length <= 60, `timeline rows (${tl.views[0]?.rows.length})`);
ok(!!tl.views[0] && tl.views[0].rows.every((r) => /^\[(signal S|history H)\d+\]$/.test(String(r.cite))), 'timeline rows carry signal/history tags');

// An empty result emits no view and does not error.
const none = await call(admin, { kind: 'table', source: 'items', params: { query: 'zzzqqqxxxnothing' } });
ok(none.views.length === 0 && !none.res.isError, 'empty result: no view, no error');

console.log(fail ? `${fail} FAILED` : 'show_view: all checks passed');
process.exit(fail ? 1 : 0);

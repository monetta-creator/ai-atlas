// Times the three legs of resolveLane (namespace load, retrieval, classifier)
// for one question. Read-only apart from the classifier's cost row.
// Run: npx -y tsx scripts/probe-lane-timing.mts "question"
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
// Log every query slower than 500 ms (patched before lib/db loads).
const pg = (await import('pg')).default;
const orig = pg.Pool.prototype.query;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pg.Pool.prototype as any).query = function (this: unknown, ...args: any[]) {
  const t = Date.now();
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (orig as any).apply(this, args);
  if (p && typeof p.then === 'function') p.then(() => { const ms = Date.now() - t; if (ms > 500) console.log(`  slow ${ms} ms: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`); }, () => {});
  return p;
};
const { buildAskContext, loadNamespace } = await import('../lib/ask/retrieve');
const { classifyQuestion } = await import('../lib/ask/classify');
const { beatDescriptionFrom } = await import('../lib/ask/lanes');
const q = process.argv[2] ?? 'What did the Philadelphia Fed estimate about AI automation risk?';
for (const pass of [1]) {
  let t = Date.now();
  const ns = await loadNamespace();
  const tNs = Date.now() - t;
  t = Date.now();
  const ctx = await buildAskContext(q, { mode: 'admin', ns });
  const tCtx = Date.now() - t;
  t = Date.now();
  const cls = await classifyQuestion(q, beatDescriptionFrom(ns), undefined);
  const tCls = Date.now() - t;
  console.log(`pass ${pass}: namespace ${tNs} ms, retrieval ${tCtx} ms (hits ${ctx.hitCount}), classifier ${tCls} ms (beat ${cls.beat})`);
}
process.exit(0);

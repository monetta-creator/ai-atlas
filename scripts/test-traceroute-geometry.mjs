import { registerHooks } from 'node:module';
const root = new URL('..', import.meta.url).pathname;
registerHooks({
  resolve(spec, ctx, next) {
    const tries = [spec];
    if (spec.startsWith('@/')) tries.push(new URL(spec.slice(2), `file://${root}`).href);
    for (const b of [...tries]) if (!/\.[a-z]+$/.test(b)) tries.push(`${b}.ts`, `${b}/index.ts`);
    let e; for (const a of tries) { try { return next(a, ctx); } catch (err) { e = err; } } throw e;
  },
});
const { PROPS } = await import(`${root}lib/traceroute/props.ts`);
const { ARCH_PARTS } = await import(`${root}lib/traceroute/architecture.ts`);
const { buildPropGeometry, buildOutlineGeometry, roundedBox } = await import(`${root}lib/traceroute/geometry.ts`);

let fail = 0, detailed = 0, verts = 0;
const check = (c, m) => { if (!c) { console.log('  FAIL', m); fail++; } };

for (const p of PROPS) {
  for (const withDetail of [true, false]) {
    const g = buildPropGeometry(p, withDetail);
    const pos = g.getAttribute('position');
    check(!!pos, `${p.id} (detail=${withDetail}) has positions`);
    check(pos.count > 0, `${p.id} has vertices`);
    const arr = pos.array;
    let bad = 0;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
    check(bad === 0, `${p.id} has no NaN vertices (${bad})`);
    const edges = buildOutlineGeometry(g);
    check(edges.getAttribute('position').count > 0, `${p.id} produces outline edges`);
    if (withDetail) { verts += pos.count; if (p.detail) detailed++; }
    if (withDetail && p.detail) {
      const bare = buildPropGeometry(p, false);
      check(pos.count > bare.getAttribute('position').count,
        `${p.id} detail "${p.detail}" ADDS geometry (${pos.count} vs bare ${bare.getAttribute('position').count})`);
      bare.dispose();
    }
    g.dispose(); edges.dispose();
  }
}
for (const a of ARCH_PARTS) {
  const g = roundedBox(a.size[0], a.size[1], a.size[2]);
  check(g.getAttribute('position').count > 0, `${a.id} rounded box`);
  g.dispose();
}
console.log(`\n  ${PROPS.length} props, ${detailed} with detail features, ${verts.toLocaleString()} vertices total`);
console.log(fail === 0 ? '  ALL GEOMETRY CHECKS PASSED' : `  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

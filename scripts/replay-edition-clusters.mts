// Offline replay of the Daily Edition's clustering over real days (read-only,
// needs the DB): loads each day's story items exactly as buildEditionPack
// does, then clusters them under the current rule and under variants, and
// prints multi-outlet cluster counts plus every merged pair so a wrong merge
// is visible by eye. Run: npx -y tsx scripts/replay-edition-clusters.mts 2026-09-22 2026-09-23 ...
import { config } from 'dotenv';
config({ path: '.env.local' });

const { loadStoryItems } = await import('../lib/edition/pack');
const { clusterStories, sameStory, tokens, normalizeEntities } = await import('../lib/edition/cluster');
type Item = Awaited<ReturnType<typeof loadStoryItems>>['items'][number];

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i += 1;
  return i / (a.size + b.size - i);
}
function pathKey(u: string): string { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return u; } }

const VARIANTS: Record<string, (a: Item, b: Item) => boolean> = {
  current: sameStory,
  A_j04: (a, b) => { const j = jaccard(new Set(tokens(a.headline)), new Set(tokens(b.headline))); if (j >= 0.4) return true; const ea = new Set(normalizeEntities(a.entities)); let sh = 0; for (const e of normalizeEntities(b.entities)) if (ea.has(e)) sh += 1; return sh >= 2 && j >= 0.2; },
  B_ent1_j025: (a, b) => { const j = jaccard(new Set(tokens(a.headline)), new Set(tokens(b.headline))); if (j >= 0.5) return true; const ea = new Set(normalizeEntities(a.entities)); let sh = 0; for (const e of normalizeEntities(b.entities)) if (ea.has(e)) sh += 1; return (sh >= 2 && j >= 0.2) || (sh >= 1 && j >= 0.25); },
  D_url: (a, b) => sameStory(a, b) || pathKey(a.url) === pathKey(b.url),
  AB_D: (a, b) => { if (pathKey(a.url) === pathKey(b.url)) return true; const j = jaccard(new Set(tokens(a.headline)), new Set(tokens(b.headline))); if (j >= 0.4) return true; const ea = new Set(normalizeEntities(a.entities)); let sh = 0; for (const e of normalizeEntities(b.entities)) if (ea.has(e)) sh += 1; return (sh >= 2 && j >= 0.2) || (sh >= 1 && j >= 0.25); },
};

function clusterWith(items: Item[], same: (a: Item, b: Item) => boolean) {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) if (find(i) !== find(j) && same(items[i], items[j])) parent[find(i)] = find(j);
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), it]); });
  return [...groups.values()];
}

for (const day of process.argv.slice(2)) {
  const { items } = await loadStoryItems(day);
  console.log(`\n===== ${day}: ${items.length} items`);
  const base = clusterStories(items);
  console.log(`current clusterStories: ${base.length} clusters, ${base.filter((c) => c.outlets.length >= 2).length} multi-outlet`);
  for (const [name, fn] of Object.entries(VARIANTS)) {
    const groups = clusterWith(items, fn);
    const multi = groups.filter((g) => new Set(g.map((x) => x.domain).filter(Boolean)).size >= 2);
    console.log(`\n-- ${name}: ${groups.length} clusters, ${multi.length} multi-outlet, ${groups.filter((g) => g.length >= 2).length} multi-item`);
    for (const g of groups.filter((g) => g.length >= 2)) console.log('   * ' + g.map((x) => `[${x.source}/${x.domain}] ${x.headline.slice(0, 70)}`).join('\n     '));
  }
}
process.exit(0);

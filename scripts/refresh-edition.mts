// Refresh sections of a saved Daily Edition in place (2026-09-26). The pack's
// front, clusters, Things happen and numbers stay frozen; only what is named
// in --sections is rewritten:
//   column    re-run the column leg (lib/edition/generate.ts) over the stored pack
//   builders  rebuild What builders are reading: the stored hn strip as the
//             candidate pool (the HN front page is live, so a past day cannot be
//             re-fetched), the window's vendor releases, one judge call
//   research  re-read the window's papers with the finding + weight fields
// One or two cheap model calls. Run:
//   npx -y tsx scripts/refresh-edition.mts 2026-09-25 --sections=column,builders,research [--dry-run]
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const day = args.find((a) => !a.startsWith('--'));
const sections = new Set((args.find((a) => a.startsWith('--sections='))?.slice(11) ?? 'column,builders,research').split(',').map((s) => s.trim()).filter(Boolean));
const dry = args.includes('--dry-run');
if (!day) { console.error('usage: tsx scripts/refresh-edition.mts <YYYY-MM-DD> [--sections=column,builders,research] [--dry-run]'); process.exit(1); }

const { getEditionForDay, getEditionPrefs, getRecentEditions } = await import('../lib/data/editions');
const { generateColumn, headsFrom } = await import('../lib/edition/generate');
const { rewriteEditionColumn, rewriteEditionPackSections } = await import('../lib/mutations/reports');
const { loadEditionPapers, loadBuilders } = await import('../lib/edition/pack');
const { judgeBuilderReads } = await import('../lib/edition/builders');
const { windowFor } = await import('../lib/edition/pure');
const { q } = await import('../lib/db');

const ed = await getEditionForDay(day);
if (!ed) { console.error('no edition for', day); process.exit(1); }
const prefs = await getEditionPrefs();
const w = windowFor(day);
const strip = (html: string) => html.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)').replace(/<[^>]+>/g, '');

if (sections.has('column')) {
  const recent = await getRecentEditions(day, 2);
  const recentColumns = recent.map((e) => ({ title: e.narrative.column.title, heads: headsFrom(e.narrative.column.html) }));
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const t0 = Date.now();
  const out = await generateColumn(ed.pack, ed.narrative.front, prefs.model, { recentColumns, weekday });
  console.log(`\n== column (${prefs.model}, ${Date.now() - t0} ms) dropped=${JSON.stringify(out.dropped)} cited=${out.cited.join(', ') || 'none'}`);
  console.log('TITLE:', out.title);
  console.log(strip(out.html).replace(/\n{2,}/g, '\n'));
  if (!dry) await rewriteEditionColumn(ed.id, { title: out.title, html: out.html }, out.cited, out.dropped, prefs.model);
}

const patch: { builders?: unknown; papers?: unknown; papersKept?: number } = {};

if (sections.has('builders')) {
  const pool = ed.pack.hn ?? [];
  const base = await loadBuilders(w, pool, pool);
  const t0 = Date.now();
  const b = await judgeBuilderReads(pool, prefs.model, prefs.builders_steering, base.products ?? [], pool);
  console.log(`\n== builders (${prefs.model}, ${Date.now() - t0} ms) judged=${b.judged}${b.error ? ` error=${b.error}` : ''} reads=${b.reads.length}/${pool.length} releases=${base.releases.length}`);
  for (const r of b.reads) console.log(`  [${r.tag}] ${r.title}\n      ${r.line ?? '(no line)'}  · ${r.points}p ${r.comments}c${r.showHn ? ' ShowHN' : ''}${r.repo ? ' repo' : ''}${r.debate ? ' debate' : ''}${r.catalogHref ? ` ${r.catalogHref}` : ''}`);
  for (const r of base.releases) console.log(`  release: ${r.productName} · ${r.title} · ${r.kind} ${r.date}`);
  const { candidates: _c, products: _p, ...rest } = base;
  void _c; void _p;
  patch.builders = { ...rest, reads: b.reads, judged: b.judged };
}

if (sections.has('research')) {
  const papers = await loadEditionPapers(w);
  const kept = await q<{ n: number }>(
    `select count(*)::int as n from papers p
      where p.triage_status = 'kept' and p.extraction is not null and p.review_status <> 'dismissed'
        and p.created_at >= $1::timestamptz and p.created_at < $2::timestamptz`,
    [w.from, w.to]
  );
  console.log(`\n== research: ${papers.length} papers (kept ${kept[0]?.n ?? '?'})`);
  for (const p of papers) console.log(`  ${'●'.repeat(p.weight?.marks ?? 0)}${'○'.repeat(3 - (p.weight?.marks ?? 0))} ${p.title.slice(0, 70)}\n      ${p.finding ?? p.whoCares ?? ''}\n      ${p.weight?.kicker ?? ''}`);
  patch.papers = papers;
  patch.papersKept = kept[0]?.n;
}

if (!dry && (patch.builders !== undefined || patch.papers !== undefined)) {
  await rewriteEditionPackSections(ed.id, patch);
  console.log('\nsaved into edition', ed.id);
} else if (dry) {
  console.log('\n(dry run, nothing saved)');
}
process.exit(0);

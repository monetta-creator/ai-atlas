// Re-run the Daily Edition's column leg for a saved day and swap it in place
// (the pack and front stay frozen). One model call on edition_prefs.model.
// Run: npx -y tsx scripts/regenerate-edition-column.mts 2026-09-25 [--dry-run]
import { config } from 'dotenv';
config({ path: '.env.local' });

const [day, flag] = process.argv.slice(2);
if (!day) { console.error('usage: tsx scripts/regenerate-edition-column.mts <YYYY-MM-DD> [--dry-run]'); process.exit(1); }
const dry = flag === '--dry-run';

const { getEditionForDay, getEditionPrefs, getRecentEditions } = await import('../lib/data/editions');
const { generateColumn, headsFrom } = await import('../lib/edition/generate');
const { rewriteEditionColumn } = await import('../lib/mutations/reports');

const ed = await getEditionForDay(day);
if (!ed) { console.error('no edition for', day); process.exit(1); }
const prefs = await getEditionPrefs();
const recent = await getRecentEditions(day, 2);
const recentColumns = recent.map((e) => ({ title: e.narrative.column.title, heads: headsFrom(e.narrative.column.html) }));
const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

const t0 = Date.now();
const out = await generateColumn(ed.pack, ed.narrative.front, prefs.model, { recentColumns, weekday });
console.log(`model ${prefs.model} in ${Date.now() - t0} ms`);
console.log('TITLE:', out.title);
console.log('dropped:', JSON.stringify(out.dropped));
console.log('cited:', out.cited.join(', ') || '(none)');
const text = out.html.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n');
console.log('WORDS:', text.split(/\s+/).filter(Boolean).length);
console.log('\n' + text);
const banned = /\b(this claim|the claim that|bridge-claim|confidence|argument map|logic tree)\b/i;
console.log('\nbanned words in prose:', banned.test(text.replace(/\]\([^)]*\)/g, ']')));
if (!dry) {
  await rewriteEditionColumn(ed.id, { title: out.title, html: out.html }, out.cited, out.dropped, prefs.model);
  console.log('saved into edition', ed.id);
}
process.exit(0);

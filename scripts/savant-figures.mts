// Plans (or re-plans) the figures for a saved Savant issue and writes them
// onto its narrative, without touching the text. For issues written before
// the figure leg existed, and for re-rolling the figures after a prompt
// change. Needs the DB and the writer model (about $0.08 per run).
// Run: npx -y tsx scripts/savant-figures.mts <week> [--show]
import { config } from 'dotenv';
config({ path: '.env.local' });

const [week, ...flags] = process.argv.slice(2);
if (!week) { console.error('usage: tsx scripts/savant-figures.mts <week-ending YYYY-MM-DD> [--show] [--force]'); process.exit(1); }

const { getSavantIssue } = await import('../lib/data/savant-issues');
const { getSavantPrefs } = await import('../lib/data/savant');
const { allowlistForSavant } = await import('../lib/savant/allowlist');
const { planFigures } = await import('../lib/savant/figures');
const { patchSavantNarrative } = await import('../lib/mutations/reports');
const { getNotebook } = await import('../lib/data/savant');

const issue = await getSavantIssue(week);
if (!issue) { console.error(`no issue for week ending ${week}`); process.exit(1); }
const prefs = await getSavantPrefs();
const { pack, narrative } = issue;

// The lead's footnote hrefs were added to the allow-list at save time from
// the parked lead leg; recover them the same way so a figure may cite them.
const allow = allowlistForSavant(pack);
const rows = await getNotebook(week);
const leadRow = rows.find((r) => r.kind === 'query' && r.key === 'leg:lead');
const tagHrefs = ((leadRow?.payload as { value?: { tagHrefs?: [string, string][] } } | undefined)?.value?.tagHrefs ?? []);
for (const [, href] of tagHrefs) allow.hrefs.add(href);

const t0 = Date.now();
const { figures, dropped } = await planFigures(
  pack,
  { leadTitle: narrative.lead.title, leadHtml: narrative.lead.html, departments: narrative.departments },
  allow.hrefs,
  { model: prefs.writer_model, weekEnd: week }
);
console.log(`${figures.length} figures in ${((Date.now() - t0) / 1000).toFixed(1)}s; dropped ${dropped.length}`);
// A run that proposes nothing does not erase a set the issue already has
// (the planner is not deterministic; an empty answer is a shrug, not a veto).
if (!figures.length && (narrative.figures?.length ?? 0) > 0 && !flags.includes('--force')) {
  console.log(`kept the existing ${narrative.figures!.length} figures (pass --force to clear them)`);
  process.exit(0);
}
for (const d of dropped) console.log(`  dropped: ${d}`);
for (const fig of figures) {
  const size = fig.kind === 'entities' ? `${fig.entities.length} cards, ${fig.entities.filter((e) => e.logo).length} logos` : fig.kind === 'map' ? `${fig.points.length} points` : fig.kind === 'relation' ? `${fig.nodes.length} nodes / ${fig.edges.length} edges` : fig.kind === 'timeline' ? `${fig.events.length} events` : fig.kind === 'compare' ? `${fig.bars.length} bars` : `${fig.steps.length} steps`;
  console.log(`  ${fig.id} ${fig.kind} in ${fig.section} after block ${fig.after}: "${fig.title}" (${size})`);
  if (flags.includes('--show')) console.log(JSON.stringify(fig, null, 2));
}
await patchSavantNarrative(issue.id, { figures, research: { ...narrative.research, dropped: [...narrative.research.dropped.filter((d) => !d.startsWith('figure dropped:')), ...dropped.map((d) => `figure dropped: ${d}`)] } });
console.log(`saved onto issue ${issue.id}`);
process.exit(0);

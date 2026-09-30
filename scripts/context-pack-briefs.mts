// Writes the Briefcase's weekly section briefs by hand (the cron does this
// on Mondays): npx -y tsx scripts/context-pack-briefs.mts [--company=<slug|self>] [--week=YYYY-MM-DD] [--force] [--show]
// --show prints each stored brief's section, word count, link count and what
// the gate dropped (never the company's name). Costs about one cent a section.
import { config } from 'dotenv';
config({ path: '.env.local' });

const PROJECT_REF = 'wuyxchwgasjefbswpxvm';
const POOLER_HOST = 'aws-1-us-east-2.pooler.supabase.com';
if (!process.env.SUPABASE_DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD not set (expected in .env.local).'); process.exit(1); }
process.env.DATABASE_URL = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@${POOLER_HOST}:6543/postgres`;
process.env.DB_POOL_MAX = '3';

const { q } = await import('../lib/db.ts');
const { runPackBriefs, checkPackBriefBudget } = await import('../lib/context-pack/briefs.ts');
const { listPackCompanies } = await import('../lib/context-pack/load.ts');

const argv = process.argv.slice(2);
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
let company = flag('company');
if (company === 'self') company = (await listPackCompanies(q)).find((c) => c.tier === 'self')?.slug;

const result = await runPackBriefs({ company, weekEnd: flag('week'), force: argv.includes('--force'), deadlineMs: 600_000, actor: 'admin' });
const budget = await checkPackBriefBudget(result.weekEnd);
console.log({ ...result, spentUsd: Number(budget.spentUsd.toFixed(4)), capUsd: budget.capUsd });

if (argv.includes('--show')) {
  const rows = await q<{ section_id: string; body: string; cite_urls: string[]; dropped: string[]; model: string }>(
    `select section_id, body, cite_urls, dropped, model from context_pack_briefs
      where week_end = $1::date ${company ? 'and company_slug = $2' : ''} order by company_slug, section_id`,
    company ? [result.weekEnd, company] : [result.weekEnd]
  );
  for (const r of rows) {
    console.log(`\n[${r.section_id}] ${r.body.split(/\s+/).length} words · ${r.cite_urls.length} links · ${r.model}`);
    for (const d of r.dropped) console.log(`   dropped: ${d}`);
  }
}
process.exit(0);

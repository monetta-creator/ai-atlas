// Local render of a company context pack (not a test, needs the DB). Writes
// the base and brief markdown files and the section rows for one company into
// private/out/context-pack/ (untracked) and prints the measured sizes: the
// character-based estimate the pack states beside an exact o200k token count.
//
//   npx -y tsx scripts/render-context-pack.mts <slug | self | all> [--quiet]
//
// `self` resolves the reader organization's registry row; `all` prints one
// summary line per active company and writes nothing. Company names are
// printed only for the single-company form; `all` prints tiers and sizes.
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
config({ path: '.env.local' });

const PROJECT_REF = 'wuyxchwgasjefbswpxvm';
const POOLER_HOST = 'aws-1-us-east-2.pooler.supabase.com';
if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error('SUPABASE_DB_PASSWORD not set (expected in .env.local).');
  process.exit(1);
}
process.env.DATABASE_URL = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@${POOLER_HOST}:6543/postgres`;
process.env.DB_POOL_MAX = '2';

const { q } = await import('../lib/db.ts');
const { listPackCompanies, loadPackInputs } = await import('../lib/context-pack/load.ts');
const { renderTier, buildSections, briefAddsContent, estimateTokens } = await import('../lib/context-pack/core.ts');
const { encode } = await import('gpt-tokenizer');

const target = process.argv[2];
if (!target) { console.error('usage: tsx scripts/render-context-pack.mts <slug | self | all>'); process.exit(1); }
const exact = (s: string) => encode(s).length;
const k = (n: number) => `${(n / 1000).toFixed(1)}k`;

if (target === 'all') {
  const inputs = await loadPackInputs(q, null);
  inputs.forEach((input, i) => {
    const base = renderTier(input, 'base'); const brief = renderTier(input, 'brief');
    const sections = buildSections(input);
    const corpus = sections.reduce((n, s) => n + s.tokens, 0);
    console.log(
      `#${String(i + 1).padStart(2, '0')} ${input.company.tier.padEnd(14)} ${input.company.deepRecord ? 'deep ' : 'light'}`,
      `base ${k(base.tokens)} (exact ${k(exact(base.markdown))})`,
      `brief ${k(brief.tokens)} (exact ${k(exact(brief.markdown))})${briefAddsContent(base, brief) ? '' : ' =base'}`,
      `sections ${sections.length} / ${k(corpus)}`
    );
  });
  process.exit(0);
}

const slug = target === 'self' ? (await listPackCompanies(q)).find((c) => c.tier === 'self')?.slug : target;
const [input] = slug ? await loadPackInputs(q, slug) : [];
if (!input) { console.error('No active company for that slug.'); process.exit(1); }

const outDir = path.join('private', 'out', 'context-pack');
fs.mkdirSync(outDir, { recursive: true });
for (const size of ['base', 'brief'] as const) {
  const t0 = Date.now();
  const doc = renderTier(input, size);
  const file = path.join(outDir, `${input.company.slug}-${size}-${input.asOf}.md`);
  fs.writeFileSync(file, doc.markdown);
  const refs = new Set([...doc.markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  console.log(
    `${size.padEnd(5)} budget ${k(doc.budget)} · estimate ${k(doc.tokens)} · exact o200k ${k(exact(doc.markdown))}`,
    `· ${(doc.markdown.length / 1024).toFixed(0)} KB · ${doc.citeUrls.length} sources, ${refs.size} reference numbers`,
    `· em dashes ${(doc.markdown.match(/—/g) ?? []).length} · ${Date.now() - t0} ms -> ${file}`
  );
}
const sections = buildSections(input);
fs.writeFileSync(path.join(outDir, `${input.company.slug}-sections-${input.asOf}.json`), JSON.stringify(sections, null, 1));
const by = new Map<string, { n: number; t: number }>();
for (const s of sections) { const e = by.get(s.kind) ?? { n: 0, t: 0 }; e.n += 1; e.t += s.tokens; by.set(s.kind, e); }
console.log(`sections ${sections.length} · ${k(sections.reduce((n, s) => n + s.tokens, 0))} tokens · largest ${Math.max(...sections.map((s) => s.tokens))}`);
for (const [kind, e] of by) console.log(`  ${kind.padEnd(9)} ${String(e.n).padStart(4)} rows  ${k(e.t)}`);
console.log(`estimate check: ${estimateTokens('x'.repeat(4000))} tokens per 4,000 characters`);
process.exit(0);

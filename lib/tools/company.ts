// company: one tracked company's registry row, recent extracted facts, recent
// intel items, and dated history mentions. Every lookup is keyed on the slug
// (indexed on intel_facts/intel_items) or bounded by a small table.
import { q } from '../db';
import { citeToken } from '../ask/deep';
import type { AtlasTool } from './types';
import { clipLines, isErr, isObj, optText, snip } from './reach-shared';

export interface CompanyInput {
  company: string;
}

interface Co {
  slug: string;
  name: string;
  tier: string | null;
  niche: string | null;
  ticker: string | null;
  domain: string | null;
  aliases: string[] | null;
  active: boolean;
  public_blurb: string | null;
}

const COLS = 'slug, name, tier::text as tier, niche, ticker, domain, aliases, active, public_blurb';

export const companyTool: AtlasTool<CompanyInput> = {
  name: 'company',
  description:
    'Look up one tracked company (a bank, fintech, or vendor in the Atlas intel registry) by slug or name: its registry profile, the most recent extracted facts, the most recent news items, and a short dated timeline of history mentions. Use before answering questions about a specific company. Facts and items carry citation tags.',
  inputSchema: {
    type: 'object',
    properties: {
      company: { type: 'string', description: 'Company slug (for example "ally") or name (for example "Ally Financial").' },
    },
    required: ['company'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    if (!isObj(input)) return 'Input must be an object.';
    const c = optText(input.company, 'company', 80);
    if (isErr(c)) return c.error;
    if (!c) return 'company is required: a slug or a name.';
    return { company: c };
  },
  async run(p, ctx) {
    ctx.status?.(`Looking up company ${snip(p.company, 40)}`);
    const needle = p.company.toLowerCase();
    // Exact slug or exact name first, then a bounded substring match.
    let rows = await q<Co>(
      `select ${COLS} from intel_companies where slug = $1 or lower(name) = $1 limit 2`,
      [needle]
    );
    if (!rows.length) {
      const like = `%${needle.replace(/[%_\\]/g, '\\$&')}%`;
      rows = await q<Co>(
        `select ${COLS} from intel_companies
          where name ilike $1 or slug ilike $1 or exists (select 1 from unnest(aliases) a where a ilike $1)
          order by name limit 6`,
        [like]
      );
    }
    if (!rows.length) return { text: `No tracked company matches "${p.company}". Try search_atlas with the name for general coverage.` };
    if (rows.length > 1) {
      return { text: `"${p.company}" matches more than one company. Call again with a slug: ${rows.map((r) => `${r.slug} (${r.name})`).join('; ')}.` };
    }
    const co = rows[0];
    const t = ctx.tagger;

    const names = [co.name, ...(co.aliases ?? [])].filter((n) => n && n.length >= 4);
    const histPats = [...new Set(names.map((n) => `%${n.replace(/[%_\\]/g, '\\$&')}%`))].slice(0, 6);

    const [facts, items, hist] = await Promise.all([
      q<{ id: string; dimension: string; fact: string; value_text: string | null; as_of: string | null }>(
        `select id::text as id, dimension, fact, value_text, to_char(as_of, 'YYYY-MM-DD') as as_of
           from intel_facts where company_slug = $1 order by created_at desc limit 8`,
        [co.slug]
      ),
      q<{ id: string; headline: string | null; summary: string | null; source_domain: string | null; published_date: string | null }>(
        `select id::text as id, headline, summary, source_domain, to_char(published_date, 'YYYY-MM-DD') as published_date
           from intel_items where company_slug = $1 order by created_at desc limit 6`,
        [co.slug]
      ),
      histPats.length
        ? q<{ id: string; url: string; title: string; published_date: string }>(
            `select id::text as id, url, title, to_char(published_date, 'YYYY-MM-DD') as published_date
               from history_items
              where triage = 'kept' and title ilike any($1::text[])
              order by published_date desc limit 6`,
            [histPats]
          )
        : Promise.resolve([]),
    ]);

    const head = [co.name, co.tier, co.niche, co.ticker ? `ticker ${co.ticker}` : null, co.domain, co.active ? null : 'inactive']
      .filter(Boolean)
      .join(' · ');
    const lines: string[] = [`Company ${co.slug}: ${head}`];
    if (co.aliases?.length) lines.push(`Also known as: ${co.aliases.slice(0, 6).join(', ')}`);
    if (co.public_blurb) lines.push(snip(co.public_blurb, 300));

    lines.push('', `Recent facts (${facts.length}):`);
    for (const f of facts) {
      lines.push(`${citeToken('fact', t.factTagFor(f.id))} ${f.dimension}: ${snip(f.fact, 200)}${f.value_text ? ` (${snip(f.value_text, 70)})` : ''}${f.as_of ? ` as of ${f.as_of}` : ''}`);
    }
    if (!facts.length) lines.push('none recorded');

    lines.push('', `Recent items (${items.length}):`);
    for (const r of items) {
      const bits = [r.source_domain, r.published_date].filter(Boolean).join(', ');
      lines.push(`${citeToken('item', t.itemTagFor(`intel:${r.id}`))} "${snip(r.headline ?? 'Untitled', 130)}"${bits ? ` (${bits})` : ''}: ${snip(r.summary, 160)}`);
    }
    if (!items.length) lines.push('none collected');

    if (hist.length) {
      lines.push('', 'History mentions (matched by company name in title):');
      for (const h of hist) {
        lines.push(`${citeToken('history', t.historyTagFor(`${h.id}|${h.url}`))} ${h.published_date} "${snip(h.title, 150)}"`);
      }
    }
    lines.push('', `For figures use the metrics tool with company "${co.slug}".`);
    return { text: clipLines(lines) };
  },
};

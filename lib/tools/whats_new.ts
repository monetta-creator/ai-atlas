// whats_new: everything the engines collected since a date, grouped by
// engine and capped. Bounded queries on indexed date columns; no prose
// generation. Keyholders get published signals only (no drafts, no per-touch
// reasons: touch_details is never selected).
import { q } from '../db';
import { asObj, capText, clampInt, clip, likeEsc, optStr, ymd } from './util-b';
import type { AtlasTool } from './types';

interface In { since?: string; days: number; topic?: string }

const PER = 6;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const whatsNewTool: AtlasTool<In> = {
  name: 'whats_new',
  description:
    'Everything the Atlas collected since a date, grouped by engine: newly published signals (high significance first), analyzed research papers, company intelligence items and extracted facts, external scan items, and tooling products first seen. About 6 per group, ranked. Use it for "what happened this week" questions, then open rows with fetch_record using the bracketed tag. Optional topic text filters every group. Tooling rows are labeled [tool slug] and cannot be opened by fetch_record yet.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'Start date, YYYY-MM-DD. Default 7 days ago; at most 31 days back.' },
      topic: { type: 'string', description: 'Optional plain-text filter matched against titles and summaries.' },
    },
    required: [],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    const o = asObj(input) ?? {};
    const since = optStr(o.since, 10);
    let days = 7;
    if (since) {
      if (!DATE_RE.test(since) || Number.isNaN(Date.parse(since))) return 'since must be a date like 2026-11-04.';
      days = clampInt(Math.ceil((Date.now() - Date.parse(`${since}T00:00:00Z`)) / 86_400_000), 0, 31, 7);
    }
    return { since, days, topic: optStr(o.topic, 80) };
  },
  async run(p, ctx) {
    const t = ctx.tagger;
    const like = p.topic ? `%${likeEsc(p.topic)}%` : null;
    ctx.status?.(`Collecting what is new in the last ${p.days} days`);
    const win = `now() - make_interval(days => $1)`;
    const [sigs, papers, intel, facts, scan, tools] = await Promise.all([
      q<{ id: string; title: string; summary: string | null; significance: string; d: string }>(
        `select id::text as id, title, summary, significance::text as significance, to_char(first_published_at, 'YYYY-MM-DD') as d
           from signals
          where is_published and archived_at is null and origin <> 'backfill'
            and first_published_at >= ${win}
            and ($2::text is null or title ilike $2 or summary ilike $2)
          order by (significance = 'high') desc, (significance = 'medium') desc, first_published_at desc
          limit ${PER}`,
        [p.days, like]
      ),
      q<{ id: string; title: string; headline: string | null; summary: string | null }>(
        `select id::text as id, title, extraction->>'headline_claim' as headline, triage_summary as summary
           from papers
          where triage_status = 'kept' and review_status <> 'dismissed' and extraction is not null
            and created_at >= ${win}
            and ($2::text is null or title ilike $2 or triage_summary ilike $2)
          order by (review_status in ('tracked', 'noted')) desc, created_at desc
          limit ${PER}`,
        [p.days, like]
      ),
      q<{ id: string; headline: string | null; summary: string | null; company_slug: string | null; d: string | null }>(
        `select id::text as id, headline, summary, company_slug, to_char(published_date, 'YYYY-MM-DD') as d
           from intel_items
          where created_at >= ${win} and significance >= 0.55 and (source_tier is null or source_tier <= 3)
            and ($2::text is null or headline ilike $2 or summary ilike $2)
          order by significance desc, created_at desc
          limit ${PER}`,
        [p.days, like]
      ),
      q<{ id: string; company_slug: string; dimension: string; fact: string }>(
        `select id::text as id, company_slug, dimension, fact
           from intel_facts
          where created_at >= ${win}
            and ($2::text is null or fact ilike $2 or company_slug ilike $2)
          order by created_at desc
          limit ${PER}`,
        [p.days, like]
      ),
      q<{ id: string; headline: string | null; summary: string | null; source_domain: string | null; d: string | null }>(
        `select id::text as id, headline, summary, source_domain, to_char(published_date, 'YYYY-MM-DD') as d
           from scan_items
          where created_at >= ${win} and relevance >= 0.55 and (source_tier is null or source_tier <= 3)
            and ($2::text is null or headline ilike $2 or summary ilike $2)
          order by relevance desc, created_at desc
          limit ${PER}`,
        [p.days, like]
      ),
      q<{ slug: string; name: string; vendor: string | null; category: string | null; one_liner: string | null; first_seen: Date | string }>(
        `select slug, name, vendor, category, one_liner, first_seen
           from tooling_products
          where status = 'cataloged' and first_seen >= current_date - $1::int
            and ($2::text is null or name ilike $2 or one_liner ilike $2 or category ilike $2)
          order by first_seen desc, name
          limit ${PER}`,
        [p.days, like]
      ),
    ]);

    const lines: string[] = [`New in the last ${p.days} days${p.topic ? ` matching "${p.topic}"` : ''}:`];
    const group = (title: string, rows: string[]) => {
      lines.push(`${title}:`);
      lines.push(...(rows.length ? rows : ['- none']));
    };
    group('Signals', sigs.map((r) => `- [signal ${t.tagFor(r.id)}] (${r.significance}, ${r.d}) ${clip(r.title, 75)}: ${clip(r.summary, 40)}`));
    group('Research papers', papers.map((r) => `- [paper ${t.paperTagFor(r.id)}] ${clip(r.title, 70)}: ${clip(r.headline ?? r.summary, 40)}`));
    group('Company intelligence', intel.map((r) => `- [item ${t.itemTagFor(`intel:${r.id}`)}] (${ymd(r.d)}${r.company_slug ? `, ${r.company_slug}` : ''}) ${clip(r.headline, 75)}: ${clip(r.summary, 40)}`));
    group('Extracted facts', facts.map((r) => `- [fact ${t.factTagFor(r.id)}] ${r.company_slug}, ${r.dimension}: ${clip(r.fact, 90)}`));
    group('External scan', scan.map((r) => `- [item ${t.itemTagFor(`scan:${r.id}`)}] (${ymd(r.d)}${r.source_domain ? `, ${r.source_domain}` : ''}) ${clip(r.headline, 75)}: ${clip(r.summary, 40)}`));
    group('Tooling first seen', tools.map((r) => `- [tool ${r.slug}] ${clip(r.name, 60)}${r.vendor ? ` (${clip(r.vendor, 40)})` : ''}, ${r.category ?? 'uncategorized'}, first seen ${ymd(r.first_seen)}: ${clip(r.one_liner, 50)}`));
    return { text: capText(lines) };
  },
};

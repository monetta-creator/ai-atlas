// report: sections of the Atlas's own published editorial reports (Daily
// Edition, research roundup, Savant), tagged so fetch_record can open one.
// Guests never reach this tool; keyholders and admin may read portalOnly
// sections (Savant's peer watch), matching search.ts. Published rows only.
import { q } from '../db';
import { reportPrefix, reportSections, REPORT_KINDS, type ReportKind, type ReportRow } from '../embed/report-sections';
import { asObj, capText, clip, optStr } from './util-b';
import type { AtlasTool } from './types';

interface In { kind: ReportKind; scope?: string }

export const reportTool: AtlasTool<In> = {
  name: 'report',
  description:
    'Read the sections of one of the Atlas\'s own published reports: the Daily Edition (edition), the Friday research roundup (roundup) or Savant, the weekly research report (savant). Defaults to the latest one; pass scope as the date (YYYY-MM-DD) the report is dated, an edition day or a week-ending day. Each section is labeled with an R tag; open one in full with fetch_record kind report.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: REPORT_KINDS, description: 'edition, roundup or savant.' },
      scope: { type: 'string', description: 'Optional report date, YYYY-MM-DD. Default: the latest.' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    const o = asObj(input);
    const kind = o?.kind;
    if (typeof kind !== 'string' || !REPORT_KINDS.includes(kind as ReportKind)) return `kind must be one of ${REPORT_KINDS.join(', ')}.`;
    const scope = optStr(o?.scope, 10);
    if (scope && !/^\d{4}-\d{2}-\d{2}$/.test(scope)) return 'scope must be a date like 2026-11-07.';
    return { kind: kind as ReportKind, scope };
  },
  async run(p, ctx) {
    ctx.status?.(`Reading the latest ${p.kind}`);
    const rows = await q<ReportRow>(
      `select id::text as id, kind::text as kind, to_char(scope_to, 'YYYY-MM-DD') as scope_to, title, narrative
         from generated_reports
        where is_published and kind = $1::report_kind_t
          and ($2::text is null or scope_to = $2::date)
        order by scope_to desc nulls last, generated_at desc
        limit 1`,
      [p.kind, p.scope ?? null]
    );
    const r = rows[0];
    if (!r) return { text: `No published ${p.kind} report${p.scope ? ` for ${p.scope}` : ''}.`, isError: true };
    const sections = reportSections(r);
    const lines = [`${clip(r.title, 120)} (${p.kind}${r.scope_to ? `, ${r.scope_to}` : ''}), ${sections.length} sections:`];
    const per = Math.max(250, Math.floor(3600 / Math.max(1, sections.length)));
    for (const s of sections) {
      const tag = ctx.tagger.reportTagFor(`report:${r.kind}:${r.scope_to ?? ''}:${r.id}:${s.key}`);
      lines.push(`- [report ${tag}] ${reportPrefix(r.kind, r.scope_to, s.label)}: ${clip(s.text, per)}`);
    }
    return { text: capText(lines) };
  },
};

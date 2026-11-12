// timeline: a dated sequence for a topic, merging kept history items with
// published, unarchived signals. Signals use signals.search_tsv; history has
// no stored tsvector, so it ranks inline over the date-bounded (kept_idx)
// rows. Signal touch details are never selected.
import { q } from '../db';
import { ORQ } from '../pack-shared';
import { citeToken } from '../ask/deep';
import type { AtlasTool } from './types';
import { clipLines, isErr, isObj, optText, parseDate, snip } from './reach-shared';

export interface TimelineInput {
  topic: string;
  from?: string;
  to?: string;
}

const HIST_TSV = "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(snippet,''))";

export interface TimelineHist { id: string; url: string; title: string; snippet: string | null; d: string }
export interface TimelineSig { id: string; title: string; summary: string | null; d: string; significance: string }

// The one timeline query (shared by the text tool and show_view): the most
// relevant `each` history items and `each` signals (default 15 each).
export async function queryTimeline(p: TimelineInput, each = 15): Promise<{ hist: TimelineHist[]; sigs: TimelineSig[] }> {
  const n = Math.max(1, Math.min(30, Math.floor(each)));
  const hp: unknown[] = [p.topic];
  const hw = [`triage = 'kept'`, `${HIST_TSV} @@ ${ORQ}`];
  const sp: unknown[] = [p.topic];
  const sw = ['is_published', 'archived_at is null', `search_tsv @@ ${ORQ}`];
  if (p.from) {
    hp.push(p.from); hw.push(`published_date >= $${hp.length}::date`);
    sp.push(p.from); sw.push(`published_at >= $${sp.length}::date`);
  }
  if (p.to) {
    hp.push(p.to); hw.push(`published_date <= $${hp.length}::date`);
    sp.push(p.to); sw.push(`published_at < ($${sp.length}::date + 1)`);
  }
  const [hist, sigs] = await Promise.all([
    q<TimelineHist>(
      `select id::text as id, url, title, snippet, to_char(published_date, 'YYYY-MM-DD') as d
         from history_items where ${hw.join(' and ')}
        order by ts_rank(${HIST_TSV}, ${ORQ}, 1) desc limit ${n}`,
      hp
    ),
    q<TimelineSig>(
      `select id::text as id, title, summary, to_char(published_at, 'YYYY-MM-DD') as d, significance::text as significance
         from signals where ${sw.join(' and ')}
        order by ts_rank(search_tsv, ${ORQ}, 1) desc limit ${n}`,
      sp
    ),
  ]);
  return { hist, sigs };
}

export const timelineTool: AtlasTool<TimelineInput> = {
  name: 'timeline',
  description:
    'A dated sequence of what happened on a topic: backfilled history items and published signals merged oldest to newest, at most 30 rows. Give a topic in plain words and optionally a date range (YYYY-MM-DD). Use for "how did X develop since Y" questions. Rows carry citation tags.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'The topic, plain words. Terms are OR-combined; rows matching more of them rank first.' },
      from: { type: 'string', description: 'Optional start date, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Optional end date, YYYY-MM-DD.' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    if (!isObj(input)) return 'Input must be an object.';
    const t = optText(input.topic, 'topic', 200);
    if (isErr(t)) return t.error;
    if (!t) return 'topic is required.';
    const from = parseDate(input.from, 'from');
    if (isErr(from)) return from.error;
    const to = parseDate(input.to, 'to');
    if (isErr(to)) return to.error;
    if (from && to && from > to) return 'from must not be after to.';
    return { topic: t, from, to };
  },
  async run(p, ctx) {
    ctx.status?.(`Building a timeline for "${snip(p.topic, 40)}"`);
    const { hist, sigs } = await queryTimeline(p);
    const rows = [
      ...hist.map((h) => ({ d: h.d, line: `${citeToken('history', ctx.tagger.historyTagFor(`${h.id}|${h.url}`))} ${h.d} "${snip(h.title, 140)}": ${snip(h.snippet, 150)}` })),
      ...sigs.map((s) => ({ d: s.d, line: `${citeToken('signal', ctx.tagger.tagFor(s.id))} ${s.d} "${snip(s.title, 140)}" (${s.significance} signal): ${snip(s.summary, 150)}` })),
    ].sort((a, b) => a.d.localeCompare(b.d));
    if (!rows.length) return { text: `No history items or published signals matched "${p.topic}"${p.from || p.to ? ' in that range' : ''}. Widen the dates or try other words.` };
    const head = `${rows.length} dated row${rows.length === 1 ? '' : 's'} for "${snip(p.topic, 60)}", oldest first (${hist.length} history, ${sigs.length} signals; the most relevant of each, not exhaustive):`;
    return { text: clipLines([head, ...rows.map((r) => r.line)]) };
  },
};

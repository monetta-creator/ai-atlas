// question_map: one map question laid out as stances, claims, bridges and the
// edges among them, with per-claim evidence balance. Confidence words are the
// admin's personal layer: getQuestion(slug, personal=false) strips them.
import { q } from '../db';
import { getQuestion } from '../data/map';
import { asObj, capText, clip, optStr, ymd } from './util-b';
import type { AtlasTool } from './types';

interface In { question: string }

export const questionMapTool: AtlasTool<In> = {
  name: 'question_map',
  description:
    'Lay out one question of the Argument Map: its stances, claims and bridge claims, the edges among them (supports, contradicts, depends_on, organizes), the evidence balance per claim (supporting vs contradicting evidence count and most recent evidence date), and each stance\'s strongest opposing stance. Pass a question slug (for example capability), or a claim code like 2.3, a bridge code like B1, or a stance code like Q1-S1A to open the question it belongs to. Rows are labeled [claim 2.3], [stance Q1-S1A], [bridge B1]; fetch_record opens any of them.',
  inputSchema: {
    type: 'object',
    properties: { question: { type: 'string', description: 'A question slug, or a claim, bridge or stance code.' } },
    required: ['question'],
    additionalProperties: false,
  },
  scopes: ['admin', 'keyholder'],
  parse(input) {
    const o = asObj(input);
    const v = o ? optStr(o.question, 80) : undefined;
    return v ? { question: v } : 'question is required: a question slug or a claim, bridge or stance code.';
  },
  async run(p, ctx) {
    const personal = ctx.identity.kind === 'admin';
    ctx.status?.('Reading the argument map');
    let slug: string | null = null;
    const bySlug = await q<{ slug: string }>(`select slug from questions where lower(slug) = lower($1)`, [p.question]);
    if (bySlug[0]) slug = bySlug[0].slug;
    if (!slug) {
      const rows = await q<{ slug: string }>(
        `select qu.slug from stances s join questions qu on qu.id = s.question_id where upper(s.code) = upper($1)
         union
         select qu.slug from claims c
           join edges e on e.from_type = 'claim' and e.from_id = c.id and e.to_type = 'stance'
           join stances s on s.id = e.to_id join questions qu on qu.id = s.question_id
          where upper(c.code) = upper($1)
         union
         select qu.slug from bridge_claims b
           join edges e on e.to_type = 'bridge_claim' and e.to_id = b.id
           join claims c on c.id = e.from_id and e.from_type = 'claim'
           join edges e2 on e2.from_type = 'claim' and e2.from_id = c.id and e2.to_type = 'stance'
           join stances s on s.id = e2.to_id join questions qu on qu.id = s.question_id
          where upper(b.code) = upper($1)
         limit 1`,
        [p.question]
      );
      slug = rows[0]?.slug ?? null;
    }
    if (!slug) return { text: `No question, claim, bridge or stance matches "${p.question}".`, isError: true };
    const v = await getQuestion(slug, personal);
    if (!v) return { text: `No question found for ${slug}.`, isError: true };

    const claimIds = v.claims.map((c) => c.id);
    const bridgeIds = v.bridges.map((b) => b.id);
    const ev = await q<{ target_type: string; target_id: string; sup: number; con: number; last: Date | null }>(
      `select target_type::text as target_type, target_id::text as target_id,
              count(*) filter (where direction = 'supports')::int as sup,
              count(*) filter (where direction = 'contradicts')::int as con,
              max(created_at) as last
         from evidence
        where (target_type = 'claim' and target_id = any($1::uuid[]))
           or (target_type = 'bridge_claim' and target_id = any($2::uuid[]))
        group by 1, 2`,
      [claimIds, bridgeIds]
    );
    const evBy = new Map(ev.map((r) => [`${r.target_type}:${r.target_id}`, r]));

    const code = new Map<string, string>();
    for (const s of v.stances) code.set(`stance:${s.id}`, `stance ${s.code}`);
    for (const c of v.claims) code.set(`claim:${c.id}`, `claim ${c.code}`);
    for (const b of v.bridges) code.set(`bridge_claim:${b.id}`, `bridge ${b.code}`);
    const conf = (c: number | null, l: string | null) => (personal && l ? ` (${l}${c != null ? ` ${Number(c).toFixed(2)}` : ''})` : '');

    const lines: string[] = [`Question "${v.question.title}" (${v.question.slug}): ${clip(v.question.summary, 200)}`];
    lines.push('Stances:');
    for (const s of v.stances) {
      const opp = v.edges
        .filter((e) => e.relation === 'contradicts' && e.from_type === 'stance' && e.to_type === 'stance' && (e.from_id === s.id || e.to_id === s.id))
        .map((e) => code.get(`stance:${e.from_id === s.id ? e.to_id : e.from_id}`))
        .filter(Boolean);
      const se = v.stanceEvidence[s.id];
      lines.push(`- [stance ${s.code}] ${clip(s.title, 110)}${s.holder ? ` (held by ${clip(s.holder, 40)})` : ''}${conf(s.confidence, s.confidence_label)}; evidence ${se?.supports ?? 0} for, ${se?.contradicts ?? 0} against${opp.length ? `; strongest opposing: ${opp.map((o) => `[${o}]`).join(', ')}` : ''}`);
    }
    lines.push('Claims:');
    for (const c of v.claims) {
      const e = evBy.get(`claim:${c.id}`);
      lines.push(`- [claim ${c.code}] ${clip(c.statement, 130)}${conf(c.confidence, c.confidence_label)}; evidence ${e?.sup ?? 0} for, ${e?.con ?? 0} against, latest ${ymd(e?.last ?? null)}`);
    }
    if (v.bridges.length) {
      lines.push('Bridges:');
      for (const b of v.bridges) {
        const e = evBy.get(`bridge_claim:${b.id}`);
        lines.push(`- [bridge ${b.code}] ${clip(b.statement, 130)} (${b.domain_from} to ${b.domain_to})${conf(b.confidence, b.confidence_label)}; evidence ${e?.sup ?? 0} for, ${e?.con ?? 0} against, latest ${ymd(e?.last ?? null)}`);
      }
    }
    lines.push('Edges:');
    const edgeLines: string[] = [];
    for (const e of v.edges) {
      const a = code.get(`${e.from_type}:${e.from_id}`);
      const b = code.get(`${e.to_type}:${e.to_id}`);
      if (a && b) edgeLines.push(`- ${a} ${e.relation} ${b}`);
    }
    lines.push(...(edgeLines.length ? edgeLines : ['- none']));
    return { text: capText(lines) };
  },
};

import type {
  AtlasSheetPack, AtlasSheetQuestion, ClaimSheetPack, ClaimSheetStats, Direction, Domain, Lens,
  LensSheetCode, LensSheetPack, Relation, Resolvability, SheetEvidence, SheetScope, SheetSignal,
  SheetSignalStats, Significance, SignalLens, SignalOrigin, Weight,
} from '../types';
import { domainOfUrl, quarterBuckets } from '../pack-shared.ts';
import type { Q } from '../pack-shared.ts';

// The deterministic core of the Report Portal's generated reports: retrieval +
// stats, zero AI, zero randomness. Same corpus + same inputs = the same pack
// byte-for-byte (generated_at aside): every ORDER BY carries a stable id
// tiebreaker, signal tags are assigned in that order, and all stats are computed
// in code. Query access is INJECTED (`Q`) like lib/thesis/pack-core.ts so
// scripts/test-tearsheet.mjs can drive the production SQL from plain Node; only
// type-only imports plus other pure modules may be imported here.
//
// GUEST-SAFE BY CONSTRUCTION: a published report's page and PDF are public, so
// nothing personal may enter a pack. The queries below never select confidence,
// confidence_label, rationales, evidence.note, reliability_prior, domain_note,
// or signals.touch_details reasons, and signal-anchored evidence rows are
// included only when their signal is published.


const CLAIM_EVIDENCE_CAP = 40;
const CLAIM_SIGNAL_CAP = 30;
const LENS_SIGNAL_CAP = 60;
const ATLAS_SIGNAL_CAP = 12;

const SIG_COLS = `
  s.id, s.title, s.summary, s.significance::text as significance,
  s.lenses::text[] as lenses,
  to_char(s.published_at, 'YYYY-MM-DD') as published_at,
  s.origin::text as origin,
  src.title as source_title, src.url as source_url`;

interface SigRow {
  id: string;
  title: string;
  summary: string | null;
  significance: Significance;
  lenses: SignalLens[];
  published_at: string | null;
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
}

interface EvRow {
  code: string;
  direction: Direction;
  weight: Weight;
  excerpt: string | null;
  lens: SignalLens | null;
  source_title: string | null;
  source_outlet: string | null;
  source_url: string | null;
  source_published: string | null;
  signal_id: string | null;
  signal_title: string | null;
  signal_published: string | null;
  noted_on: string;
}

export function hrefFor(type: 'claim' | 'bridge_claim', code: string): string {
  return type === 'bridge_claim' ? `/bridge/${code}` : `/claim/${encodeURIComponent(code)}`;
}

// Scope filter over a 'YYYY-MM-DD' date (null dates fail a bounded scope).
export function inScope(date: string | null, scope: SheetScope): boolean {
  if (!scope.from && !scope.to) return true;
  if (!date) return false;
  if (scope.from && date < scope.from) return false;
  if (scope.to && date > scope.to) return false;
  return true;
}

function scopeSentence(scope: SheetScope): string {
  if (!scope.from && !scope.to) return 'Scope: the full corpus.';
  if (scope.from && scope.to) return `Scope: ${scope.from} to ${scope.to}.`;
  if (scope.from) return `Scope: from ${scope.from}.`;
  return `Scope: through ${scope.to}.`;
}

function toSheetSignal(row: SigRow, i: number, direction: Direction | null): SheetSignal {
  return {
    id: row.id,
    tag: `S${i + 1}`,
    title: row.title,
    summary: row.summary,
    significance: row.significance,
    lenses: row.lenses,
    published_at: row.published_at,
    origin: row.origin,
    source_title: row.source_title,
    source_url: row.source_url,
    source_domain: domainOfUrl(row.source_url),
    direction,
  };
}

function signalStats(signals: SheetSignal[]): SheetSignalStats {
  const byDirection = { supports: 0, contradicts: 0, neutral: 0, untyped: 0 };
  for (const s of signals) byDirection[s.direction ?? 'untyped']++;
  const significance = { high: 0, medium: 0, low: 0 };
  for (const s of signals) significance[s.significance]++;
  const lensCounts = new Map<SignalLens, number>();
  for (const s of signals) for (const l of s.lenses) lensCounts.set(l, (lensCounts.get(l) ?? 0) + 1);
  const dates = signals.map((s) => s.published_at).filter((d): d is string => !!d).sort();
  return {
    total: signals.length,
    byDirection,
    significance,
    lenses: [...lensCounts.entries()]
      .map(([lens, n]) => ({ lens, n }))
      .sort((a, b) => b.n - a.n || a.lens.localeCompare(b.lens)),
    recency: quarterBuckets(signals.map((s) => s.published_at)),
    firstPublished: dates[0] ?? null,
    lastPublished: dates[dates.length - 1] ?? null,
  };
}

const toSheetEvidence = (e: EvRow, tagBySignal: Map<string, string>): SheetEvidence => ({
  code: e.code,
  direction: e.direction,
  weight: e.weight,
  excerpt: e.excerpt?.trim() || null,
  lens: e.lens,
  source_title: e.source_title,
  source_outlet: e.source_outlet,
  source_url: e.source_url,
  source_published: e.source_published,
  signal_id: e.signal_id,
  signal_tag: e.signal_id ? tagBySignal.get(e.signal_id) ?? null : null,
  signal_title: e.signal_title,
  noted_on: e.noted_on,
});

// Evidence scope rule: a signal-anchored row follows its signal's published date;
// a source-anchored row follows its source date, falling back to when the
// evidence was noted.
const evidenceInScope = (e: EvRow, scope: SheetScope): boolean =>
  e.signal_id ? inScope(e.signal_published, scope) : inScope(e.source_published ?? e.noted_on, scope);

// The shared evidence select for one target code. Signal-anchored rows are
// included only when the signal is PUBLISHED (drafts must never leak into a
// shareable pack).
const EV_SQL = `
  select coalesce(c.code, b.code) as code,
         e.direction::text as direction, e.weight::text as weight,
         e.excerpt, e.lens::text as lens,
         src.title as source_title, src.outlet as source_outlet, src.url as source_url,
         to_char(src.published_at, 'YYYY-MM-DD') as source_published,
         e.signal_id, sig.title as signal_title,
         to_char(sig.published_at, 'YYYY-MM-DD') as signal_published,
         to_char(e.created_at, 'YYYY-MM-DD') as noted_on
    from evidence e
    left join claims c on e.target_type = 'claim' and c.id = e.target_id
    left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
    left join sources src on src.id = e.source_id
    left join signals sig on sig.id = e.signal_id
   where (e.signal_id is null or sig.is_published = true)`;

// ---------------------------------------------------------------- claim / bridge

export async function buildClaimSheetPack(q: Q, code: string, scope: SheetScope): Promise<ClaimSheetPack> {
  const isBridge = /^B\d/i.test(code);

  const nodeRows = isBridge
    ? await q<{
        id: string; code: string; statement: string; test: string | null;
        resolvability: Resolvability | null; reflexive: boolean;
        domain_from: Domain | null; domain_to: Domain | null;
      }>(
        `select id, code, statement, test, resolvability::text as resolvability, reflexive,
                domain_from::text as domain_from, domain_to::text as domain_to
           from bridge_claims where code = $1`,
        [code]
      )
    : await q<{
        id: string; code: string; statement: string; test: string | null;
        resolvability: Resolvability | null; reflexive: boolean;
        domain: Domain | null; is_frame: boolean;
      }>(
        `select id, code, statement, test, resolvability::text as resolvability, reflexive,
                domain::text as domain, is_frame
           from claims where code = $1`,
        [code]
      );
  const nodeRow = nodeRows[0];
  if (!nodeRow) throw new Error(`No ${isBridge ? 'bridge-claim' : 'claim'} with code ${code}.`);
  if (!isBridge && (nodeRow as { is_frame?: boolean }).is_frame) {
    throw new Error('Frames organize the map and carry no evidence: no tear sheet.');
  }
  const nodeId = nodeRow.id;
  const type = isBridge ? 'bridge_claim' as const : 'claim' as const;

  const [lensRows, stanceRows, bridgeRows, frameRows, conceptRows, thesisRows, evRows, sigRows] =
    await Promise.all([
      isBridge
        ? Promise.resolve([] as { lens: Lens }[])
        : q<{ lens: Lens }>(
            `select lens::text as lens from node_lenses
              where target_type = 'claim' and target_id = $1 order by lens`,
            [nodeId]
          ),
      isBridge
        ? Promise.resolve([] as { relation: Relation; stance_code: string; stance_title: string; q_slug: string; q_title: string }[])
        : q<{ relation: Relation; stance_code: string; stance_title: string; q_slug: string; q_title: string }>(
            `select e.relation::text as relation, s.code as stance_code, s.title as stance_title,
                    qn.slug as q_slug, qn.title as q_title
               from edges e
               join stances s on e.to_type = 'stance' and s.id = e.to_id
               join questions qn on qn.id = s.question_id
              where e.from_type = 'claim' and e.from_id = $1
              order by e.relation, s.code`,
            [nodeId]
          ),
      isBridge
        ? q<{ relation: Relation; code: string; statement: string }>(
            `select e.relation::text as relation, c.code, c.statement
               from edges e
               join claims c on e.from_type = 'claim' and c.id = e.from_id
              where e.to_type = 'bridge_claim' and e.to_id = $1
              order by e.relation, c.code`,
            [nodeId]
          )
        : q<{ relation: Relation; code: string; statement: string }>(
            `select e.relation::text as relation, b.code, b.statement
               from edges e
               join bridge_claims b on e.to_type = 'bridge_claim' and b.id = e.to_id
              where e.from_type = 'claim' and e.from_id = $1
              order by e.relation, b.code`,
            [nodeId]
          ),
      isBridge
        ? Promise.resolve([] as { code: string; statement: string }[])
        : q<{ code: string; statement: string }>(
            `select fc.code, fc.statement
               from edges e
               join claims fc on e.from_type = 'claim' and fc.id = e.from_id and fc.is_frame = true
              where e.relation = 'organizes' and e.to_type = 'claim' and e.to_id = $1
              order by fc.code`,
            [nodeId]
          ),
      q<{ slug: string; name: string; status: 'settled' | 'contested' }>(
        `select cn.slug, cn.name, cn.status::text as status
           from concept_claims cc
           join concepts cn on cn.id = cc.concept_id
          where cc.target_code = $1 and cc.status = 'confirmed'
          order by cn.slug`,
        [code]
      ),
      q<{ id: string; statement: string; latest_report_id: string | null }>(
        `select t.id, t.statement,
                (select r.id from thesis_reports r
                  where r.thesis_id = t.id order by r.generated_at desc, r.id limit 1) as latest_report_id
           from theses t
          where t.claim_codes @> array[$1]::text[]
          order by t.statement, t.id`,
        [code]
      ),
      q<EvRow>(
        `${EV_SQL} and coalesce(c.code, b.code) = $1
          order by e.created_at desc, e.id`,
        [code]
      ),
      q<SigRow>(
        `select ${SIG_COLS}
           from signals s left join sources src on src.id = s.source_id
          where s.is_published = true and s.claim_touches @> array[$1]::text[]
          order by s.published_at desc nulls last, s.id`,
        [code]
      ),
    ]);

  // Direction toward THIS code, from the materialized evidence rows.
  const directionBySignal = new Map<string, Direction>();
  for (const e of evRows) {
    if (e.signal_id && e.code === code && !directionBySignal.has(e.signal_id)) {
      directionBySignal.set(e.signal_id, e.direction);
    }
  }

  const scopedSignals = sigRows.filter((r) => inScope(r.published_at, scope)).slice(0, CLAIM_SIGNAL_CAP);
  const signals = scopedSignals.map((r, i) => toSheetSignal(r, i, directionBySignal.get(r.id) ?? null));
  const tagBySignal = new Map(signals.map((s) => [s.id, s.tag]));

  const scopedEv = evRows.filter((e) => evidenceInScope(e, scope)).slice(0, CLAIM_EVIDENCE_CAP);
  const evidence = scopedEv.map((e) => toSheetEvidence(e, tagBySignal));

  // Stats, all in code.
  const evCounts = { supports: 0, contradicts: 0, neutral: 0 };
  const byWeight = { high: 0, medium: 0, low: 0 };
  for (const e of evidence) {
    evCounts[e.direction]++;
    byWeight[e.weight]++;
  }
  const oneSided =
    (evCounts.supports >= 2 && evCounts.contradicts === 0) ||
    (evCounts.contradicts >= 2 && evCounts.supports === 0);
  const sigStats = signalStats(signals);
  const thin = evidence.length < 5;

  const noteParts: string[] = [];
  noteParts.push(
    `${evidence.length} evidence item${evidence.length === 1 ? '' : 's'} bear on this ` +
    `${isBridge ? 'bridge-claim' : 'claim'} (${evCounts.supports} supporting, ` +
    `${evCounts.contradicts} contradicting, ${evCounts.neutral} neutral), and ` +
    `${signals.length} published signal${signals.length === 1 ? '' : 's'} touch it.`
  );
  if (oneSided) {
    noteParts.push('Warning: the evidence is one-sided. It may reflect coverage, not reality.');
  }
  if (thin) {
    noteParts.push('Coverage is thin. Treat this report as orientation on limited evidence, not a verdict.');
  }
  if (sigStats.firstPublished && sigStats.lastPublished) {
    noteParts.push(`Touching signals span ${sigStats.firstPublished} to ${sigStats.lastPublished}.`);
  }
  noteParts.push(scopeSentence(scope));

  const stats: ClaimSheetStats = {
    evidence: { total: evidence.length, ...evCounts, byWeight, oneSided },
    signals: sigStats,
    thin,
    corpusNote: noteParts.join(' '),
  };

  return {
    kind: isBridge ? 'bridge' : 'claim',
    subject: code,
    scope,
    generated_at: new Date().toISOString(),
    node: {
      code,
      type,
      statement: nodeRow.statement,
      test: nodeRow.test,
      resolvability: nodeRow.resolvability,
      reflexive: nodeRow.reflexive,
      domain: isBridge ? null : (nodeRow as { domain: Domain | null }).domain,
      domain_from: isBridge ? (nodeRow as { domain_from: Domain | null }).domain_from : null,
      domain_to: isBridge ? (nodeRow as { domain_to: Domain | null }).domain_to : null,
      href: hrefFor(type, code),
      lenses: lensRows.map((r) => r.lens),
    },
    stances: stanceRows,
    bridges: bridgeRows.map((r) => ({
      relation: r.relation,
      code: r.code,
      statement: r.statement,
      href: isBridge ? hrefFor('claim', r.code) : hrefFor('bridge_claim', r.code),
    })),
    frames: frameRows.map((r) => ({ ...r, href: hrefFor('claim', r.code) })),
    concepts: conceptRows.map((r) => ({ ...r, href: `/concepts/${r.slug}` })),
    theses: thesisRows,
    evidence,
    signals,
    stats,
  };
}

// ---------------------------------------------------------------- lens

export async function buildLensSheetPack(
  q: Q, lens: SignalLens, label: string, scope: SheetScope
): Promise<LensSheetPack> {
  const sigRows = await q<SigRow & { claim_touches: string[] }>(
    `select ${SIG_COLS}, s.claim_touches
       from signals s left join sources src on src.id = s.source_id
      where s.is_published = true and $1::signal_lens_t = any(s.lenses)
      order by s.published_at desc nulls last, s.id`,
    [lens]
  );
  const scoped = sigRows.filter((r) => inScope(r.published_at, scope)).slice(0, LENS_SIGNAL_CAP);
  const signals = scoped.map((r, i) => toSheetSignal(r, i, null));
  const tagBySignal = new Map(signals.map((s) => [s.id, s.tag]));
  const signalIds = scoped.map((r) => r.id);

  // Evidence: rows materialized by the pack's signals, plus rows tagged with the
  // lens directly (manual attach). Deduped by evidence identity in SQL order.
  const evRows = signalIds.length
    ? await q<EvRow>(
        `${EV_SQL} and (e.signal_id = any($1::uuid[]) or e.lens = $2::signal_lens_t)
              and coalesce(c.code, b.code) is not null
          order by e.created_at desc, e.id`,
        [signalIds, lens]
      )
    : await q<EvRow>(
        `${EV_SQL} and e.lens = $1::signal_lens_t and coalesce(c.code, b.code) is not null
          order by e.created_at desc, e.id`,
        [lens]
      );
  const scopedEv = evRows.filter((e) => evidenceInScope(e, scope)).slice(0, CLAIM_EVIDENCE_CAP);
  const evidence = scopedEv.map((e) => toSheetEvidence(e, tagBySignal));

  // The codes the lens's signals touch, resolved with statements + tests.
  const touchCounts = new Map<string, number>();
  for (const r of scoped) for (const c of r.claim_touches) touchCounts.set(c, (touchCounts.get(c) ?? 0) + 1);
  const codeList = [...touchCounts.keys()].sort();
  const codeRows = codeList.length
    ? await q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; test: string | null }>(
        `select code, 'claim'::text as type, statement, test
           from claims where code = any($1::text[]) and is_frame = false
         union all
         select code, 'bridge_claim'::text as type, statement, test
           from bridge_claims where code = any($1::text[])
         order by code`,
        [codeList]
      )
    : [];

  const dirByCode = new Map<string, { supports: number; contradicts: number; neutral: number }>();
  for (const e of evidence) {
    const d = dirByCode.get(e.code) ?? { supports: 0, contradicts: 0, neutral: 0 };
    d[e.direction]++;
    dirByCode.set(e.code, d);
  }
  const codes: LensSheetCode[] = codeRows.map((r) => ({
    code: r.code,
    type: r.type,
    statement: r.statement,
    test: r.test,
    href: hrefFor(r.type, r.code),
    signal_count: touchCounts.get(r.code) ?? 0,
    directions: dirByCode.get(r.code) ?? { supports: 0, contradicts: 0, neutral: 0 },
  })).sort((a, b) => b.signal_count - a.signal_count || a.code.localeCompare(b.code));

  const oneSidedCodes = codes
    .filter((c) => {
      const d = c.directions;
      return (d.supports >= 2 && d.contradicts === 0) || (d.contradicts >= 2 && d.supports === 0);
    })
    .map((c) => c.code);

  const sigStats = signalStats(signals);
  const thin = signals.length < 5;
  const noteParts: string[] = [];
  noteParts.push(
    `${signals.length} published signal${signals.length === 1 ? '' : 's'} carry the ${label} lens, ` +
    `touching ${codes.length} claim${codes.length === 1 ? '' : 's'} on the map, with ` +
    `${evidence.length} evidence item${evidence.length === 1 ? '' : 's'} in view.`
  );
  if (oneSidedCodes.length) {
    noteParts.push(
      `Direction data is one-sided for ${oneSidedCodes.length} touched claim${oneSidedCodes.length === 1 ? '' : 's'}, which may reflect coverage, not reality.`
    );
  }
  if (thin) {
    noteParts.push('Coverage is thin. Treat this report as orientation on limited evidence, not a verdict.');
  }
  if (sigStats.firstPublished && sigStats.lastPublished) {
    noteParts.push(`Signals span ${sigStats.firstPublished} to ${sigStats.lastPublished}.`);
  }
  noteParts.push(scopeSentence(scope));

  return {
    kind: 'lens',
    subject: lens,
    scope,
    generated_at: new Date().toISOString(),
    label,
    signals,
    codes,
    evidence,
    stats: {
      signals: sigStats,
      codes: codes.length,
      oneSidedCodes,
      thin,
      corpusNote: noteParts.join(' '),
    },
  };
}

// ---------------------------------------------------------------- atlas

export async function buildAtlasSheetPack(q: Q, scope: SheetScope): Promise<AtlasSheetPack> {
  const [stanceRows, stanceEvRows, healthRows, targetRows, thesisRows, sigRows] = await Promise.all([
    q<{
      q_slug: string; q_title: string; q_sort: number; s_sort: number;
      code: string; title: string; claims_supporting: number; claims_contradicting: number;
    }>(
      `select qn.slug as q_slug, qn.title as q_title, qn.sort_order as q_sort,
              st.sort_order as s_sort, st.code, st.title,
              count(*) filter (where ed.relation = 'supports')::int as claims_supporting,
              count(*) filter (where ed.relation = 'contradicts')::int as claims_contradicting
         from stances st
         join questions qn on qn.id = st.question_id
         left join edges ed on ed.to_type = 'stance' and ed.to_id = st.id and ed.from_type = 'claim'
        group by qn.slug, qn.title, qn.sort_order, st.sort_order, st.code, st.title
        order by qn.sort_order, st.sort_order, st.code`
    ),
    // Evidence rolled up to the stances the evidenced claims SUPPORT (the same
    // upward rollup the question pages use).
    q<{ stance_code: string; direction: Direction; n: number }>(
      `select st.code as stance_code, e.direction::text as direction, count(*)::int as n
         from evidence e
         join claims c on e.target_type = 'claim' and c.id = e.target_id and c.is_frame = false
         join edges ed on ed.from_type = 'claim' and ed.from_id = c.id
                      and ed.to_type = 'stance' and ed.relation = 'supports'
         join stances st on st.id = ed.to_id
         left join signals sig on sig.id = e.signal_id
        where (e.signal_id is null or sig.is_published = true)
        group by st.code, e.direction
        order by st.code, e.direction`
    ),
    q<{ claims: number; bridges: number; evidence: number; signals_published: number }>(
      `select (select count(*) from claims where is_frame = false)::int as claims,
              (select count(*) from bridge_claims)::int as bridges,
              (select count(*) from evidence)::int as evidence,
              (select count(*) from signals where is_published = true)::int as signals_published`
    ),
    q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; supports: number; contradicts: number }>(
      `select coalesce(c.code, b.code) as code,
              case when c.code is not null then 'claim' else 'bridge_claim' end as type,
              coalesce(c.statement, b.statement) as statement,
              count(*) filter (where e.direction = 'supports')::int as supports,
              count(*) filter (where e.direction = 'contradicts')::int as contradicts
         from evidence e
         left join claims c on e.target_type = 'claim' and c.id = e.target_id and c.is_frame = false
         left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
         left join signals sig on sig.id = e.signal_id
        where coalesce(c.code, b.code) is not null
          and (e.signal_id is null or sig.is_published = true)
        group by 1, 2, 3
        order by 1`
    ),
    q<{
      statement: string; report_id: string; matched: number;
      supports: number; contradicts: number; mixed: number; generated_at: string;
    }>(
      `select statement, id as report_id,
              coalesce((pack->'stats'->>'matched')::int, 0) as matched,
              coalesce((pack->'stats'->'stances'->>'supports')::int, 0) as supports,
              coalesce((pack->'stats'->'stances'->>'contradicts')::int, 0) as contradicts,
              coalesce((pack->'stats'->'stances'->>'mixed')::int, 0) as mixed,
              generated_at::text as generated_at
         from (
           select distinct on (thesis_id) *
             from thesis_reports
            order by thesis_id, generated_at desc
         ) t
        order by generated_at desc, id`
    ),
    q<SigRow>(
      `select ${SIG_COLS}
         from signals s left join sources src on src.id = s.source_id
        where s.is_published = true
        order by case s.significance when 'high' then 0 when 'medium' then 1 else 2 end,
                 s.published_at desc nulls last, s.id`
    ),
  ]);

  const evByStance = new Map<string, { supports: number; contradicts: number; neutral: number }>();
  for (const r of stanceEvRows) {
    const d = evByStance.get(r.stance_code) ?? { supports: 0, contradicts: 0, neutral: 0 };
    d[r.direction] += r.n;
    evByStance.set(r.stance_code, d);
  }
  const questions: AtlasSheetQuestion[] = [];
  for (const r of stanceRows) {
    let qn = questions.find((x) => x.slug === r.q_slug);
    if (!qn) {
      qn = { slug: r.q_slug, title: r.q_title, stances: [] };
      questions.push(qn);
    }
    qn.stances.push({
      code: r.code,
      title: r.title,
      claims_supporting: r.claims_supporting,
      claims_contradicting: r.claims_contradicting,
      evidence: evByStance.get(r.code) ?? { supports: 0, contradicts: 0, neutral: 0 },
    });
  }

  const health = healthRows[0] ?? { claims: 0, bridges: 0, evidence: 0, signals_published: 0 };
  const covered = new Set(targetRows.map((t) => t.code));
  const uncovered = health.claims + health.bridges - covered.size;
  const oneSidedAll = targetRows.filter(
    (t) => (t.supports >= 2 && t.contradicts === 0) || (t.contradicts >= 2 && t.supports === 0)
  );
  const oneSidedTargets = oneSidedAll.slice(0, 8).map((t) => ({
    code: t.code,
    statement: t.statement,
    href: hrefFor(t.type, t.code),
  }));

  const scoped = sigRows.filter((r) => inScope(r.published_at, scope)).slice(0, ATLAS_SIGNAL_CAP);
  const signals = scoped.map((r, i) => toSheetSignal(r, i, null));

  const note =
    `The Atlas tracks ${health.claims} claims and ${health.bridges} bridge-claims across ` +
    `${questions.length} open questions, with ${health.evidence} evidence items and ` +
    `${health.signals_published} published signals. ${uncovered} tracked nodes carry no evidence yet, ` +
    `and the evidence on ${oneSidedAll.length} is one-sided. ` +
    `The ${signals.length} signals cited here are the most significant recent developments in scope. ` +
    scopeSentence(scope);

  return {
    kind: 'atlas',
    subject: null,
    scope,
    generated_at: new Date().toISOString(),
    questions,
    health: {
      claims: health.claims,
      bridges: health.bridges,
      evidence: health.evidence,
      signalsPublished: health.signals_published,
      uncovered,
      oneSided: oneSidedAll.length,
    },
    oneSidedTargets,
    theses: thesisRows.map((t) => ({ ...t, report_id: t.report_id ?? null, generated_at: t.generated_at ?? null })),
    signals,
    stats: { corpusNote: note },
  };
}

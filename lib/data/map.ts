import { q, one } from '../db';
import { confidenceBand } from '../format';
import type {
  Question, QuestionStats, Stance, Claim, BridgeClaim, Edge, Evidence, Lens, Source,
  Direction, Domain, SummaryMetrics, QuestionSummaryRow, ConfidenceLabel,
  NodeOption, Worldview, WorldviewComponent, WorldviewPosition,
  CalibrationData, CalibrationSnapshot, CalibrationTrajectory, CalibrationMove,
  } from '../types';
import { countEvidence, getEvidenceFor, getRationales, strip, stripClaim } from './shared';

// ---------------------------------------------------------------- landing
export async function getQuestions(personal: boolean): Promise<QuestionStats[]> {
  const rows = await q<QuestionStats>(`
    select q.id, q.title, q.slug, q.summary, q.primary_lens, q.sort_order,
      (select count(*) from stances s where s.question_id = q.id)::int as stance_count,
      (select count(distinct e.from_id) from edges e
         join stances s2 on s2.id = e.to_id and e.to_type = 'stance'
        where s2.question_id = q.id and e.from_type = 'claim')::int as claim_count,
      (select count(distinct e.from_id) from edges e
         join stances s2 on s2.id = e.to_id and e.to_type = 'stance'
         join claims c on c.id = e.from_id
        where s2.question_id = q.id and e.from_type = 'claim'
          and c.confidence_label = 'contested')::int as contested_count,
      (select count(distinct ev.id) from evidence ev
         join edges e on e.from_type = 'claim' and e.from_id = ev.target_id and e.to_type = 'stance'
         join stances s5 on s5.id = e.to_id
        where s5.question_id = q.id and ev.target_type = 'claim')::int as evidence_count,
      (select max(r.created_at) from rationales r where
         (r.target_type = 'stance' and r.target_id in (select id from stances where question_id = q.id))
         or (r.target_type = 'claim' and r.target_id in (
              select distinct e2.from_id from edges e2
                join stances s3 on s3.id = e2.to_id and e2.to_type = 'stance'
               where s3.question_id = q.id and e2.from_type = 'claim'))
      ) as last_moved
    from questions q order by q.sort_order`);

  // contested counts and "last moved" are part of the personal layer — keep
  // them off the wire for guests.
  if (personal) return rows;
  return rows.map((r) => ({ ...r, contested_count: 0, last_moved: null }));
}

// ---------------------------------------------------------------- question map
interface QuestionView {
  question: Question;
  stances: Stance[];
  claims: Claim[];
  bridges: BridgeClaim[];
  edges: Edge[];
  // Evidence rolled up from each stance's claims (public — the map shows evidence to
  // guests). Keyed by stance id. The upward flow Evidence → Claim → Stance.
  stanceEvidence: Record<string, { supports: number; contradicts: number; neutral: number }>;
}

export async function getQuestion(slug: string, personal: boolean): Promise<QuestionView | null> {
  const question = await one<Question>(`select * from questions where slug = $1`, [slug]);
  if (!question) return null;

  const stances = await q<Stance>(
    `select * from stances where question_id = $1 order by sort_order`,
    [question.id]
  );
  const claims = await q<Claim>(
    `select distinct c.* from claims c
       join edges e on e.from_type = 'claim' and e.from_id = c.id
       join stances s on s.id = e.to_id and e.to_type = 'stance'
      where s.question_id = $1 and c.is_frame = false
      order by c.code`,
    [question.id]
  );
  const stanceIds = stances.map((s) => s.id);
  const claimIds = claims.map((c) => c.id);

  const edges = await q<Edge>(
    `select * from edges
      where (from_type = 'stance' and from_id = any($1::uuid[]))
         or (to_type   = 'stance' and to_id   = any($1::uuid[]))
         or (from_type = 'claim'  and from_id = any($2::uuid[]))`,
    [stanceIds, claimIds]
  );

  const bridgeIds = [...new Set(edges.filter((e) => e.to_type === 'bridge_claim').map((e) => e.to_id))];
  const bridges = bridgeIds.length
    ? await q<BridgeClaim>(`select * from bridge_claims where id = any($1::uuid[]) order by code`, [bridgeIds])
    : [];

  // Upward rollup: sum each stance's claims' evidence. Evidence is public, so these
  // counts are not stripped (unlike confidence). A claim attached to two stances
  // contributes to both — that is correct (it is evidence behind each).
  const stanceEvidence: Record<string, { supports: number; contradicts: number; neutral: number }> = {};
  for (const s of stances) stanceEvidence[s.id] = { supports: 0, contradicts: 0, neutral: 0 };
  if (claimIds.length) {
    const evRows = await q<{ target_id: string; direction: Direction; n: number }>(
      `select target_id, direction, count(*)::int as n
         from evidence
        where target_type = 'claim' and target_id = any($1::uuid[])
        group by target_id, direction`,
      [claimIds]
    );
    const perClaim = new Map<string, { supports: number; contradicts: number; neutral: number }>();
    for (const r of evRows) {
      const c = perClaim.get(r.target_id) ?? { supports: 0, contradicts: 0, neutral: 0 };
      c[r.direction] += r.n;
      perClaim.set(r.target_id, c);
    }
    for (const e of edges) {
      if (e.from_type === 'claim' && e.to_type === 'stance' && stanceEvidence[e.to_id]) {
        const c = perClaim.get(e.from_id);
        if (c) {
          const agg = stanceEvidence[e.to_id];
          agg.supports += c.supports;
          agg.contradicts += c.contradicts;
          agg.neutral += c.neutral;
        }
      }
    }
  }

  return {
    question,
    stances: stances.map((s) => strip(s, personal)),
    claims: claims.map((c) => stripClaim(c, personal)),
    bridges: bridges.map((b) => strip(b, personal)),
    edges,
    stanceEvidence,
  };
}

// ---------------------------------------------------------------- claim / frame detail
interface StanceLink {
  relation: string; note: string | null; stance_code: string; stance_title: string;
  q_slug: string; q_title: string;
}
interface BridgeLink {
  relation: string; note: string | null; bridge_code: string; bridge_statement: string;
}

export async function getClaim(code: string, personal: boolean) {
  const claim = await one<Claim>(`select * from claims where code = $1`, [code]);
  if (!claim) return null;

  const lenses = (
    await q<{ lens: Lens }>(`select lens from node_lenses where target_type = 'claim' and target_id = $1`, [claim.id])
  ).map((r) => r.lens);

  const toStances = await q<StanceLink>(
    `select e.relation, e.note, s.code as stance_code, s.title as stance_title,
            qn.slug as q_slug, qn.title as q_title
       from edges e
       join stances s on s.id = e.to_id and e.to_type = 'stance'
       join questions qn on qn.id = s.question_id
      where e.from_type = 'claim' and e.from_id = $1
      order by e.relation`,
    [claim.id]
  );

  const toBridges = await q<BridgeLink>(
    `select e.relation, e.note, b.code as bridge_code, b.statement as bridge_statement
       from edges e join bridge_claims b on b.id = e.to_id and e.to_type = 'bridge_claim'
      where e.from_type = 'claim' and e.from_id = $1 order by b.code`,
    [claim.id]
  );

  // frames that organize THIS claim (incoming)
  const frames = await q<{ code: string; statement: string }>(
    `select fc.code, fc.statement from edges e join claims fc on fc.id = e.from_id
      where e.relation = 'organizes' and e.to_type = 'claim' and e.to_id = $1 and fc.is_frame = true`,
    [claim.id]
  );

  // what this node organizes (outgoing) — populated when the node is itself a frame
  const organizes = await q<{ code: string; statement: string }>(
    `select c.code, c.statement from edges e join claims c on c.id = e.to_id
      where e.from_id = $1 and e.relation = 'organizes' and e.from_type = 'claim' and e.to_type = 'claim'
      order by c.code`,
    [claim.id]
  );

  const evidence = await getEvidenceFor('claim', claim.id, personal);
  const counts = countEvidence(evidence);
  const rationales = personal ? await getRationales('claim', claim.id) : [];

  return { claim: stripClaim(claim, personal), lenses, toStances, toBridges, frames, organizes, evidence, counts, rationales };
}

// ---------------------------------------------------------------- bridge detail
interface FedByLink {
  relation: string; note: string | null; claim_code: string; claim_statement: string;
}

export async function getBridge(code: string, personal: boolean) {
  const bridge = await one<BridgeClaim>(`select * from bridge_claims where code = $1`, [code]);
  if (!bridge) return null;

  const fedBy = await q<FedByLink>(
    `select e.relation, e.note, c.code as claim_code, c.statement as claim_statement
       from edges e join claims c on c.id = e.from_id
      where e.to_type = 'bridge_claim' and e.to_id = $1 and e.from_type = 'claim'
      order by e.relation, c.code`,
    [bridge.id]
  );

  const evidence = await getEvidenceFor('bridge_claim', bridge.id, personal);
  const counts = countEvidence(evidence);
  const rationales = personal ? await getRationales('bridge_claim', bridge.id) : [];

  return { bridge: strip(bridge, personal), fedBy, evidence, counts, rationales };
}

// ---------------------------------------------------------------- bridges overview
export async function getBridges(personal: boolean) {
  const bridges = await q<BridgeClaim>(`select * from bridge_claims order by code`);
  const fed = await q<FedByLink & { bridge_id: string }>(
    `select e.to_id as bridge_id, e.relation, e.note,
            c.code as claim_code, c.statement as claim_statement
       from edges e join claims c on c.id = e.from_id
      where e.to_type = 'bridge_claim' and e.from_type = 'claim'
      order by e.relation, c.code`
  );
  return bridges.map((b) => ({
    bridge: strip(b, personal),
    fedBy: fed.filter((f) => f.bridge_id === b.id),
  }));
}

// ---------------------------------------------------------------- data editor (admin)
// Raw, un-stripped rows for the /data editor. That page is admin-only (it redirects
// guests), so the route guard is the personal-layer firewall here, not strip().
interface DomainRows {
  questions: Question[];
  stances: Stance[];
  claims: Claim[];
  bridges: BridgeClaim[];
}

export async function getAllDomainRows(): Promise<DomainRows> {
  const [questions, stances, claims, bridges] = await Promise.all([
    q<Question>(`select * from questions order by sort_order`),
    q<Stance>(`select * from stances order by question_id, sort_order`),
    q<Claim>(`select * from claims order by code`),
    q<BridgeClaim>(`select * from bridge_claims order by code`),
  ]);
  return { questions, stances, claims, bridges };
}

// ---------------------------------------------------------------- ingest / sources (admin)
export interface TargetOption {
  id: string;
  code: string;
  statement: string;
  type: 'claim' | 'bridge_claim';
}

export async function getTargets(): Promise<{ claims: TargetOption[]; bridges: TargetOption[] }> {
  const claims = await q<TargetOption>(
    `select id, code, statement, 'claim'::text as type from claims where is_frame = false order by code`
  );
  const bridges = await q<TargetOption>(
    `select id, code, statement, 'bridge_claim'::text as type from bridge_claims order by code`
  );
  return { claims, bridges };
}

// Lightweight source bibliography for prompt enrichment (no evidence join, unlike getSource).
export async function getSourceMeta(
  id: string
): Promise<{ title: string | null; author: string | null; outlet: string | null } | null> {
  return one<{ title: string | null; author: string | null; outlet: string | null }>(
    `select title, author, outlet from sources where id = $1`,
    [id]
  );
}

export async function getSources(): Promise<Source[]> {
  return q<Source>(`select * from sources order by created_at desc`);
}

interface SourceEvidenceRow extends Evidence {
  target_code: string | null;
  target_statement: string | null;
}

export async function getSource(id: string) {
  const source = await one<Source & { raw_text: string | null }>(
    `select * from sources where id = $1`,
    [id]
  );
  if (!source) return null;
  const evidence = await q<SourceEvidenceRow>(
    `select ev.*,
            coalesce(c.code, b.code) as target_code,
            coalesce(c.statement, b.statement) as target_statement
       from evidence ev
       left join claims c on ev.target_type = 'claim' and c.id = ev.target_id
       left join bridge_claims b on ev.target_type = 'bridge_claim' and b.id = ev.target_id
      where ev.source_id = $1
      order by ev.created_at desc`,
    [id]
  );
  return { source, evidence };
}

// The "as of" date for the share view: the most recent moment the author touched the
// map (a confidence move or a snapshot). GREATEST ignores NULLs; null if neither exists.
export async function getAsOf(): Promise<string | null> {
  const row = await one<{ at: string | null }>(
    `select greatest(
       (select max(created_at) from rationales),
       (select max(taken_at) from snapshots)
     ) as at`
  );
  return row?.at ?? null;
}

// ---------------------------------------------------------------- calibration (snapshot/rationale reader)
// Admin-only. Reads the confidence history that moveConfidence already records (a full
// `snapshots` row + a `rationales` row per move) and shapes it for the viewer: a band
// distribution per snapshot, a per-node trajectory for anything that actually moved,
// and the rationale movement log (with any cited evidence resolved). All times are
// pre-formatted to strings so the client component gets plain serializable data.
type SnapshotState = { [bucket: string]: Record<string, number | null> | undefined };

export async function getCalibration(): Promise<CalibrationData> {
  // 1) node metadata to resolve snapshot/rationale ids -> code/label/href
  const meta = new Map<string, { type: 'claim' | 'bridge_claim' | 'stance' | 'position'; code: string | null; label: string; href: string }>();
  const bucketOf: Record<string, string> = { claim: 'claims', bridge_claim: 'bridge_claims', stance: 'stances', position: 'positions' };

  // code is `text unique` (nullable in schema) but present for every node by convention;
  // filter nulls so the href can never become "/claim/null" (and the type stays honest).
  (await q<{ id: string; code: string; label: string }>(
    `select id, code, statement as label from claims where is_frame = false and code is not null`
  )).forEach((r) => meta.set(r.id, { type: 'claim', code: r.code, label: r.label, href: `/claim/${encodeURIComponent(r.code)}` }));
  (await q<{ id: string; code: string; label: string }>(
    `select id, code, statement as label from bridge_claims where code is not null`
  )).forEach((r) => meta.set(r.id, { type: 'bridge_claim', code: r.code, label: r.label, href: `/bridge/${r.code}` }));
  (await q<{ id: string; code: string; label: string; slug: string }>(
    `select s.id, s.code, s.title as label, qn.slug from stances s join questions qn on qn.id = s.question_id where s.code is not null`
  )).forEach((r) => meta.set(r.id, { type: 'stance', code: r.code, label: r.label, href: `/q/${r.slug}` }));
  (await q<{ id: string; label: string }>(
    `select id, statement as label from positions_crosscutting`
  )).forEach((r) => meta.set(r.id, { type: 'position', code: null, label: r.label, href: '/worldview' }));

  // 2) snapshots (chronological) -> band distribution
  const snapRows = await q<{ at: string; trigger: string; state: SnapshotState }>(
    `select to_char(taken_at, 'Mon DD, YYYY HH24:MI') as at, trigger, state
       from snapshots order by taken_at asc`
  );
  const snapshots: CalibrationSnapshot[] = snapRows.map((s) => {
    const bands = { thin: 0, contested: 0, leaning: 0, settled: 0 };
    let total = 0;
    for (const bucket of ['claims', 'stances', 'bridge_claims', 'positions']) {
      const m = s.state?.[bucket];
      if (!m) continue;
      for (const v of Object.values(m)) {
        const band = confidenceBand(v);
        if (!band) continue;
        bands[band] += 1;
        total += 1;
      }
    }
    return { at: s.at, trigger: s.trigger, bands, total };
  });

  // 3) trajectories — only nodes whose confidence actually changed across the series
  const trajectories: CalibrationTrajectory[] = [];
  for (const [id, m] of meta) {
    const bucket = bucketOf[m.type];
    const points: { at: string; confidence: number }[] = [];
    for (let i = 0; i < snapRows.length; i++) {
      const v = snapRows[i].state?.[bucket]?.[id];
      if (v !== undefined && v !== null) points.push({ at: snapshots[i].at, confidence: v });
    }
    if (points.length < 2) continue;
    let moves = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].confidence - points[i - 1].confidence) > 1e-9) moves += 1;
    }
    if (moves === 0) continue;
    trajectories.push({
      type: m.type, id, code: m.code, label: m.label, href: m.href,
      points, first: points[0].confidence, current: points[points.length - 1].confidence, moves,
    });
  }
  trajectories.sort((a, b) => b.moves - a.moves || Math.abs(b.current - b.first) - Math.abs(a.current - a.first));

  // 4) movement log — rationales, newest first, with node + cited-evidence resolution
  const ratRows = await q<{
    id: string; at: string; target_id: string;
    old_confidence: number | null; new_confidence: number | null; reason: string;
    evidence_excerpt: string | null; evidence_direction: Direction | null; evidence_source: string | null;
  }>(
    `select r.id, to_char(r.created_at, 'Mon DD, YYYY HH24:MI') as at, r.target_id,
            r.old_confidence, r.new_confidence, r.reason,
            ev.excerpt as evidence_excerpt, ev.direction as evidence_direction,
            coalesce(s.title, sig.title) as evidence_source
       from rationales r
       left join evidence ev on ev.id = r.evidence_id
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      order by r.created_at desc`
  );
  const moves: CalibrationMove[] = ratRows.map((r) => {
    const m = meta.get(r.target_id);
    return {
      id: r.id, at: r.at, code: m?.code ?? null, label: m?.label ?? '(removed node)', href: m?.href ?? null,
      old_confidence: r.old_confidence, new_confidence: r.new_confidence, reason: r.reason,
      evidence_excerpt: r.evidence_excerpt, evidence_direction: r.evidence_direction, evidence_source: r.evidence_source,
    };
  });

  return {
    snapshots,
    trajectories,
    moves,
    totals: {
      snapshots: snapshots.length,
      moves: moves.length,
      nodesMoved: trajectories.length,
      firstAt: snapshots[0]?.at ?? null,
      lastAt: snapshots[snapshots.length - 1]?.at ?? null,
    },
  };
}

// ---------------------------------------------------------------- question state summaries
interface SummaryInputClaim {
  code: string; statement: string; domain: string | null; test: string | null;
  confidence_label: string | null; supports: number; contradicts: number; neutral: number;
}
interface SummaryInputBridge extends SummaryInputClaim {
  domain_from: string; domain_to: string;
}
export interface SummaryInput {
  question: { title: string; summary: string | null; primary_lens: string | null };
  stances: { code: string; title: string; holder: string | null; test: string; confidence_label: string | null }[];
  claims: SummaryInputClaim[];
  bridges: SummaryInputBridge[];
  relationships: string[];
  metrics: SummaryMetrics;
}

export async function getQuestionBySlug(slug: string): Promise<Question | null> {
  return one<Question>(`select * from questions where slug = $1`, [slug]);
}

// Assemble everything the summary generator needs — the full question state plus
// evidence counts per target — and compute the (code-trustworthy) metrics. Admin
// view (confidence labels included); the feature is admin-only.
export async function getQuestionSummaryInput(questionId: string): Promise<SummaryInput | null> {
  const question = await one<Question>(`select * from questions where id = $1`, [questionId]);
  if (!question) return null;

  const stances = await q<Stance>(`select * from stances where question_id = $1 order by sort_order`, [questionId]);
  const claims = await q<Claim>(
    `select distinct c.* from claims c
       join edges e on e.from_type = 'claim' and e.from_id = c.id
       join stances s on s.id = e.to_id and e.to_type = 'stance'
      where s.question_id = $1 and c.is_frame = false
      order by c.code`,
    [questionId]
  );
  const stanceIds = stances.map((s) => s.id);
  const claimIds = claims.map((c) => c.id);
  const edges = await q<Edge>(
    `select * from edges
      where (from_type = 'stance' and from_id = any($1::uuid[]))
         or (to_type   = 'stance' and to_id   = any($1::uuid[]))
         or (from_type = 'claim'  and from_id = any($2::uuid[]))`,
    [stanceIds, claimIds]
  );
  const bridgeIds = [...new Set(edges.filter((e) => e.to_type === 'bridge_claim').map((e) => e.to_id))];
  const bridges = bridgeIds.length
    ? await q<BridgeClaim>(`select * from bridge_claims where id = any($1::uuid[]) order by code`, [bridgeIds])
    : [];

  const evRows = (claimIds.length || bridgeIds.length)
    ? await q<{ target_type: string; target_id: string; direction: Direction; n: number }>(
        `select target_type, target_id, direction, count(*)::int as n
           from evidence
          where (target_type = 'claim' and target_id = any($1::uuid[]))
             or (target_type = 'bridge_claim' and target_id = any($2::uuid[]))
          group by target_type, target_id, direction`,
        [claimIds, bridgeIds]
      )
    : [];
  const counts = new Map<string, { supports: number; contradicts: number; neutral: number }>();
  for (const r of evRows) {
    const k = `${r.target_type}:${r.target_id}`;
    const c = counts.get(k) ?? { supports: 0, contradicts: 0, neutral: 0 };
    if (r.direction === 'supports') c.supports += r.n;
    else if (r.direction === 'contradicts') c.contradicts += r.n;
    else c.neutral += r.n;
    counts.set(k, c);
  }
  const cFor = (type: string, id: string) => counts.get(`${type}:${id}`) ?? { supports: 0, contradicts: 0, neutral: 0 };

  const code = new Map<string, string>();
  stances.forEach((s) => code.set(`stance:${s.id}`, s.code));
  claims.forEach((c) => code.set(`claim:${c.id}`, c.code));
  bridges.forEach((b) => code.set(`bridge_claim:${b.id}`, b.code));
  const relationships: string[] = [];
  for (const e of edges) {
    const from = code.get(`${e.from_type}:${e.from_id}`);
    const to = code.get(`${e.to_type}:${e.to_id}`);
    if (from && to) relationships.push(`${from} ${e.relation} ${to}`);
  }

  const claimOut: SummaryInputClaim[] = claims.map((c) => {
    const e = cFor('claim', c.id);
    return { code: c.code, statement: c.statement, domain: c.domain, test: c.test, confidence_label: c.confidence_label, supports: e.supports, contradicts: e.contradicts, neutral: e.neutral };
  });
  const bridgeOut: SummaryInputBridge[] = bridges.map((b) => {
    const e = cFor('bridge_claim', b.id);
    return { code: b.code, statement: b.statement, domain: null, domain_from: b.domain_from, domain_to: b.domain_to, test: b.test, confidence_label: b.confidence_label, supports: e.supports, contradicts: e.contradicts, neutral: e.neutral };
  });

  const all = [...claimOut, ...bridgeOut];
  const supporting = all.reduce((n, x) => n + x.supports, 0);
  const contradicting = all.reduce((n, x) => n + x.contradicts, 0);
  const neutralN = all.reduce((n, x) => n + x.neutral, 0);
  const metrics: SummaryMetrics = {
    stances: stances.length,
    claims: claims.length,
    bridges: bridges.length,
    contested: claims.filter((c) => c.confidence_label === 'contested').length,
    evidence_total: supporting + contradicting + neutralN,
    supporting,
    contradicting,
    neutral: neutralN,
    claims_without_evidence: claimOut.filter((c) => c.supports + c.contradicts + c.neutral === 0).length,
    one_sided: all.filter((x) => (x.supports >= 2 && x.contradicts === 0) || (x.contradicts >= 2 && x.supports === 0)).length,
  };

  return {
    question: { title: question.title, summary: question.summary, primary_lens: question.primary_lens },
    stances: stances.map((s) => ({ code: s.code, title: s.title, holder: s.holder, test: s.test, confidence_label: s.confidence_label })),
    claims: claimOut,
    bridges: bridgeOut,
    relationships,
    metrics,
  };
}

export async function getQuestionSummaries(questionId: string): Promise<QuestionSummaryRow[]> {
  return q<QuestionSummaryRow>(
    `select * from question_summaries where question_id = $1 order by created_at desc`,
    [questionId]
  );
}

// ---------------------------------------------------------------- sources hub
export interface SourceWithCounts extends Source {
  evidence_count: number;
  supports: number;
  contradicts: number;
  neutral: number;
}

// Sources + per-source evidence tally (excludes raw_text to keep the payload small;
// keeps dossier for the inline peek).
export async function getSourcesWithCounts(): Promise<SourceWithCounts[]> {
  return q<SourceWithCounts>(`
    select s.id, s.title, s.author, s.outlet, s.url, s.published_at, s.domain_tag,
           s.reliability_prior, s.dossier, s.created_at,
           count(ev.id)::int as evidence_count,
           count(*) filter (where ev.direction = 'supports')::int as supports,
           count(*) filter (where ev.direction = 'contradicts')::int as contradicts,
           count(*) filter (where ev.direction = 'neutral')::int as neutral
      from sources s
      left join evidence ev on ev.source_id = s.id
     group by s.id
     order by s.created_at desc`);
}

export interface EvidenceGraphSource {
  id: string; title: string | null; outlet: string | null;
  domain_tag: Domain | null; reliability_prior: number | null; has_dossier: boolean;
}
export interface EvidenceGraphClaim {
  id: string; code: string; statement: string;
  q_slug: string; q_sort: number; q_title: string;
}
export interface EvidenceGraphBridge { id: string; code: string; statement: string }
export interface EvidenceGraphEdge {
  source_id: string; target_type: 'claim' | 'bridge_claim'; target_id: string; direction: Direction;
}
export interface EvidenceGraph {
  sources: EvidenceGraphSource[];
  claims: EvidenceGraphClaim[];
  bridges: EvidenceGraphBridge[];
  edges: EvidenceGraphEdge[];
}

// The full source → claim/bridge evidence graph for the visualization.
export async function getEvidenceGraph(): Promise<EvidenceGraph> {
  const sources = await q<EvidenceGraphSource>(
    `select id, title, outlet, domain_tag, reliability_prior, (dossier is not null) as has_dossier
       from sources order by created_at desc`
  );
  // one row per claim, carrying its lowest-sort question (for grouping)
  const claims = await q<EvidenceGraphClaim>(
    `select distinct on (c.id) c.id, c.code, c.statement,
            qn.slug as q_slug, qn.sort_order as q_sort, qn.title as q_title
       from claims c
       join edges e on e.from_type = 'claim' and e.from_id = c.id
       join stances s on s.id = e.to_id and e.to_type = 'stance'
       join questions qn on qn.id = s.question_id
      where c.is_frame = false
      order by c.id, qn.sort_order`
  );
  claims.sort((a, b) => a.q_sort - b.q_sort || a.code.localeCompare(b.code));
  const bridges = await q<EvidenceGraphBridge>(`select id, code, statement from bridge_claims order by code`);
  // The graph is source → claim/bridge; signal-only evidence (source_id null) has no
  // source node to anchor to, so it is excluded from this source-centric view.
  const edges = await q<EvidenceGraphEdge>(
    `select source_id, target_type, target_id, direction from evidence where source_id is not null`
  );
  return { sources, claims, bridges, edges };
}

// ---------------------------------------------------------------- worldview (admin)
// Every node the author can attach to a cross-cutting position. Admin-only feature.
export async function getNodeOptions(): Promise<{ stances: NodeOption[]; claims: NodeOption[]; bridges: NodeOption[] }> {
  const stances = await q<NodeOption>(
    `select 'stance'::text as type, s.id, s.code, s.title as label, qn.title as question
       from stances s join questions qn on qn.id = s.question_id
      order by qn.sort_order, s.sort_order`
  );
  const claims = await q<NodeOption>(
    `select 'claim'::text as type, id, code, statement as label, null::text as question
       from claims where is_frame = false order by code`
  );
  const bridges = await q<NodeOption>(
    `select 'bridge_claim'::text as type, id, code, statement as label, null::text as question
       from bridge_claims order by code`
  );
  return { stances, claims, bridges };
}

// The bridge spine + the author's cross-cutting positions (with their components
// resolved to linkable nodes). Admin-only; positions are personal-layer.
export async function getWorldview(): Promise<Worldview> {
  const spine = await q<BridgeClaim>(`select * from bridge_claims order by code`);
  const positions = await q<{
    id: string; statement: string; confidence: number | null;
    confidence_label: ConfidenceLabel; private: boolean;
  }>(`select id, statement, confidence, confidence_label, private from positions_crosscutting order by created_at`);

  const posIds = positions.map((p) => p.id);
  const comps = posIds.length
    ? await q<{ id: string; position_id: string; type: string; code: string; label: string; slug: string | null }>(
        `select pc.id, pc.position_id, pc.target_type::text as type,
                coalesce(s.code, c.code, b.code) as code,
                coalesce(s.title, c.statement, b.statement) as label,
                qn.slug
           from position_components pc
           left join stances s on pc.target_type = 'stance' and s.id = pc.target_id
           left join questions qn on qn.id = s.question_id
           left join claims c on pc.target_type = 'claim' and c.id = pc.target_id
           left join bridge_claims b on pc.target_type = 'bridge_claim' and b.id = pc.target_id
          where pc.position_id = any($1::uuid[])
          order by pc.created_at`,
        [posIds]
      )
    : [];

  const byPos = new Map<string, WorldviewComponent[]>();
  for (const c of comps) {
    const type = c.type as WorldviewComponent['type'];
    const href = type === 'claim' ? `/claim/${c.code}`
      : type === 'bridge_claim' ? `/bridge/${c.code}`
      : c.slug ? `/q/${c.slug}` : '#';
    const list = byPos.get(c.position_id) ?? [];
    list.push({ id: c.id, type, code: c.code, label: c.label, href });
    byPos.set(c.position_id, list);
  }

  const out: WorldviewPosition[] = positions.map((p) => ({
    id: p.id,
    statement: p.statement,
    confidence: p.confidence,
    confidence_label: p.confidence_label,
    private: p.private,
    components: byPos.get(p.id) ?? [],
  }));
  return { spine, positions: out };
}


// ---------------------------------------------------------------- lenses
// All current lens tags as a map keyed `${type}:${id}` (for the /data tagger).
export async function getNodeLensMap(): Promise<Record<string, Lens[]>> {
  const rows = await q<{ target_type: string; target_id: string; lens: Lens }>(
    `select target_type, target_id, lens from node_lenses`
  );
  const map: Record<string, Lens[]> = {};
  for (const r of rows) {
    const k = `${r.target_type}:${r.target_id}`;
    (map[k] ??= []).push(r.lens);
  }
  return map;
}

// Lens hub: how many nodes carry each lens, plus the questions whose primary_lens
// is set (their natural entry point).
export async function getLensIndex(): Promise<{
  counts: Record<string, number>;
  questions: { slug: string; title: string; primary_lens: Lens }[];
}> {
  const rows = await q<{ lens: Lens; n: number }>(
    `select lens, count(*)::int as n from node_lenses group by lens`
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.lens] = r.n;
  const questions = await q<{ slug: string; title: string; primary_lens: Lens }>(
    `select slug, title, primary_lens from questions where primary_lens is not null order by sort_order`
  );
  return { counts, questions };
}

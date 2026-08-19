import { q, one } from './db';
import { confidenceBand } from './format';
import { isNeverAutoBlocked } from './pipeline/config';
import type {
  Question, QuestionStats, Stance, Claim, BridgeClaim, Edge, Evidence, Rationale, Lens, Source,
  Direction, Domain, SummaryMetrics, QuestionSummaryRow, ConfidenceLabel,
  NodeOption, Worldview, WorldviewComponent, WorldviewPosition,
  Signal, SignalTouch, SignalLens, Significance, PipelineRun, SignalCandidate, SignalsPageResult,
  ReportTouch, SavedReportMeta, Report,
  DedupeRecommendation,
  CalibrationData, CalibrationSnapshot, CalibrationTrajectory, CalibrationMove,
  TopClaim, PipelineAnalytics, PipelineRunPoint, RunLensCount, RunTriageBreakdown,
  LensPerformance, PipelineImpact, CandidateArchiveFilters, CandidateArchiveResult, CandidateArchiveRow,
  MapHealth,
  CostDashboard, RateCard, CostSummary, DailyCostPoint, FeatureCost, RunCost, CostLogRow,
  Concept, ConceptEdge, ConceptGraphData, ConceptRef, ConceptClaimLink, ConceptDetail,
  ConceptGapScan, ArgumentGapScan,
  Paper, ResearchRun, ResearchThread, ThreadPaperRow, ResearchThreadScan, WatchlistRow, RisingReject,
  RecentThreadRevision, Ticket, TicketKind, TicketStatus,
  Thesis, ThesisReportMeta, SavedThesisReport,
  GeneratedReportMeta, SavedSheet,
  Company, CompanyEvent, CompanyEventWithCompany, ScoutVertical, ScoutRun, ScoutPrefs,
  CompanyDocument,
} from './types';

// Strip the personal layer (confidence) before it ever leaves the server for a
// guest. The map (questions/stances/claims/bridges/tests/evidence) stays; the
// private read does not. This is the structural firewall behind the share view.
function strip<T extends { confidence: number | null; confidence_label: unknown }>(
  row: T, personal: boolean
): T {
  return personal ? row : { ...row, confidence: null, confidence_label: null };
}

// Claims carry an extra private field (the raw seed domain note) that must also
// be withheld from guests at the data layer.
function stripClaim(c: Claim, personal: boolean): Claim {
  if (personal) return c;
  return { ...c, confidence: null, confidence_label: null, domain_note: null };
}

interface EvidenceCounts {
  supports: number;
  contradicts: number;
  neutral: number;
  oneSided: boolean;
}

function countEvidence(rows: Evidence[]): EvidenceCounts {
  const supports = rows.filter((r) => r.direction === 'supports').length;
  const contradicts = rows.filter((r) => r.direction === 'contradicts').length;
  const neutral = rows.filter((r) => r.direction === 'neutral').length;
  const oneSided =
    (supports >= 2 && contradicts === 0) || (contradicts >= 2 && supports === 0);
  return { supports, contradicts, neutral, oneSided };
}

async function getEvidenceFor(
  targetType: 'claim' | 'bridge_claim', targetId: string, personal: boolean
): Promise<Evidence[]> {
  // source_id is nullable since 0006 (a signal can be its own source), so both joins
  // are LEFT. signal_title gives the claim page "via <signal>" provenance. Signal-derived
  // evidence only exists for PUBLISHED signals, so no publish gating is needed here.
  const rows = await q<Evidence>(
    `select ev.*, s.title as source_title, s.outlet as source_outlet, s.reliability_prior,
            sig.title as signal_title
       from evidence ev
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where ev.target_type = $1 and ev.target_id = $2
      order by ev.created_at desc`,
    [targetType, targetId]
  );
  return personal ? rows : rows.map((r) => ({ ...r, reliability_prior: null, note: null }));
}

async function getRationales(
  targetType: string, targetId: string
): Promise<Rationale[]> {
  // Resolve the cited evidence (if any) so the history can show what triggered the move.
  return q<Rationale>(
    `select r.*, ev.excerpt as evidence_excerpt, ev.direction as evidence_direction,
            coalesce(s.title, sig.title) as evidence_source
       from rationales r
       left join evidence ev on ev.id = r.evidence_id
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where r.target_type = $1 and r.target_id = $2
      order by r.created_at desc`,
    [targetType, targetId]
  );
}

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

// ---- Signal Board ----------------------------------------------------------
// The public feed IS the share view: guests/public see published signals only;
// the author also sees drafts. Filters (since/lenses/significance) are accepted at
// the data layer from the start so the future digest job can reuse this read.

interface SignalQuery {
  admin?: boolean;             // the author sees drafts too
  publishedOnly?: boolean;     // force published-only regardless of admin (digests)
  since?: string;              // ISO timestamp — published_at >= since
  until?: string;              // 'YYYY-MM-DD' — published_at < until::date + 1 (inclusive end-day)
  lenses?: SignalLens[];       // array-overlap filter
  significance?: Significance[];
}

// `s.lenses::text[]` — node-pg has no parser for the custom signal_lens_t[] OID, so we
// cast to text[] (a well-known OID) to guarantee a JS string[] reaches the app.
export const SIGNAL_COLUMNS = `
  s.id, s.title, s.summary, s.significance,
  s.lenses::text[] as lenses, s.claim_touches,
  s.source_id, s.published_at, s.is_published, s.archived_at, s.origin, s.created_at, s.updated_at,
  src.title as source_title, src.url as source_url`;

export async function getSignals(opts: SignalQuery = {}): Promise<Signal[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const publishedOnly = opts.publishedOnly || !opts.admin;
  if (publishedOnly) where.push('s.is_published = true');
  if (opts.since) {
    params.push(opts.since);
    where.push(`s.published_at >= $${params.length}::timestamptz`);
  }
  if (opts.until) {
    params.push(opts.until);
    // Half-open upper bound: published_at is timestamptz but `until` is a YYYY-MM-DD day,
    // so `< until::date + 1` keeps the whole end day in range (a plain `<= until` would
    // drop everything published after 00:00 on that day).
    where.push(`s.published_at < ($${params.length}::date + 1)`);
  }
  if (opts.lenses && opts.lenses.length) {
    params.push(opts.lenses);
    where.push(`s.lenses && $${params.length}::signal_lens_t[]`);
  }
  if (opts.significance && opts.significance.length) {
    params.push(opts.significance);
    where.push(`s.significance = any($${params.length}::significance_t[])`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
       ${clause}
      order by s.published_at desc, s.created_at desc`,
    params
  );
}

interface SignalPageQuery {
  admin?: boolean;                                      // server-set; drafts visible only when true
  status?: 'published' | 'unpublished' | 'archived';   // honored only when admin
  lenses?: SignalLens[];
  significance?: Significance[];
  search?: string;
  page?: number;
  pageSize?: number;
}

// Paginated/searchable feed read for the Signal Board (admin board + guest feed). Built
// param-safely like getCandidateArchive. The published/draft gate is enforced HERE: a
// non-admin caller is forced to published-only regardless of `status`. Separate from
// getSignals (which the digest still uses) so that caller's Signal[] return is untouched.
export async function getSignalsPage(opts: SignalPageQuery): Promise<SignalsPageResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.admin) {
    where.push('s.is_published = true');                 // guest floor — drafts never leak
  } else if (opts.status === 'published') {
    where.push('s.is_published = true');
  } else if (opts.status === 'archived') {
    where.push('s.is_published = false');
    where.push('s.archived_at is not null');             // set-aside drafts
  } else if (opts.status === 'unpublished') {
    where.push('s.is_published = false');
    where.push('s.archived_at is null');                 // ACTIVE drafts only (archived excluded)
  }
  if (opts.lenses && opts.lenses.length) {
    params.push(opts.lenses);
    where.push(`s.lenses && $${params.length}::signal_lens_t[]`);
  }
  if (opts.significance && opts.significance.length) {
    params.push(opts.significance);
    where.push(`s.significance = any($${params.length}::significance_t[])`);
  }
  if (opts.search) {
    // Escape LIKE metacharacters, then parameterize (mirrors getCandidateArchive).
    const term = `%${opts.search.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`;
    params.push(term);
    where.push(`(s.title ilike $${params.length} or s.summary ilike $${params.length})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const pageSize = Math.min(Math.max(opts.pageSize ?? 12, 1), 50);
  const page = Math.max(opts.page ?? 1, 1);

  const [rows, totalRow] = await Promise.all([
    q<Signal>(
      `select ${SIGNAL_COLUMNS}
         from signals s
         left join sources src on src.id = s.source_id
         ${clause}
        order by s.published_at desc, s.created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    one<{ n: number }>(`select count(*)::int as n from signals s ${clause}`, params),
  ]);
  return { rows, total: totalRow?.n ?? 0, page, pageSize };
}

// Enumerate ALL unpublished drafts (the input to the draft-queue dedupe scan): pipeline
// drafts AND manual ones, across every run. The source outlet is joined in for the prompt.
export async function getAllDraftSignals(): Promise<{
  id: string; title: string; summary: string | null; source_domain: string | null;
}[]> {
  return q<{ id: string; title: string; summary: string | null; source_domain: string | null }>(
    `select s.id, s.title, s.summary, src.outlet as source_domain
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = false and s.archived_at is null
      order by s.created_at desc`,
    []
  );
}

// Ids of the active drafts (unpublished, not archived) — used to reconcile a persisted dedupe
// scan against reality on read (drafts merged/discarded/published/archived since the scan drop).
export async function getActiveDraftIds(): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id from signals where is_published = false and archived_at is null`,
    []
  );
  return rows.map((r) => r.id);
}

// The persisted board-level dedupe scan (singleton), or null if none.
export async function getDedupeScan(): Promise<DedupeRecommendation | null> {
  const row = await one<{ recommendation: DedupeRecommendation }>(
    `select recommendation from dedupe_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop groups whose canonical is gone or that have no surviving duplicate, so a persisted scan
// never shows a draft that was since merged/discarded/published/archived. Pure (no DB).
export function reconcileDedupeScan(
  rec: DedupeRecommendation | null, activeIds: Set<string>
): DedupeRecommendation | null {
  if (!rec) return null;
  const groups = rec.groups
    .map((g) => ({ ...g, duplicates: g.duplicates.filter((m) => activeIds.has(m.signal_id)) }))
    .filter((g) => activeIds.has(g.canonical.signal_id) && g.duplicates.length > 0);
  return groups.length ? { ...rec, groups } : null;
}

// Resolve a signal's claim_touches codes back to the claims/bridge-claims they name,
// preserving the author's order and folding in each touch's direction/reason from
// touch_details. A code that no longer resolves is dropped for guests; for the admin
// it surfaces as an `unresolved` marker (the drift guard). confidence_label and the
// model's reason are personal-layer — nulled for guests, like everywhere else.
// Falsification tests keyed by claim/bridge code, for enriching AI prompts that already
// hold the resolved touches (SignalTouch carries the statement but not the test).
export async function getTestsByCodes(codes: string[]): Promise<Record<string, string | null>> {
  if (!codes || !codes.length) return {};
  const rows = await q<{ code: string; test: string | null }>(
    `select code, test from claims where code = any($1)
     union all
     select code, test from bridge_claims where code = any($1)`,
    [codes]
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.test]));
}

async function resolveTouches(
  codes: string[],
  touchDetails: Record<string, { direction?: Direction; reason?: string }> | null | undefined,
  personal: boolean
): Promise<SignalTouch[]> {
  if (!codes || !codes.length) return [];
  const rows = await q<{
    code: string; type: 'claim' | 'bridge_claim';
    statement: string; domain: Domain | null; confidence_label: ConfidenceLabel;
  }>(
    `select code, 'claim'::text as type, statement, domain::text as domain, confidence_label
       from claims where code = any($1)
     union all
     select code, 'bridge_claim'::text as type, statement, domain_from::text as domain, confidence_label
       from bridge_claims where code = any($1)`,
    [codes]
  );
  // Safe to key on bare code: claim and bridge-claim code namespaces are disjoint by
  // construction (bridges are B1..Bn, claims are numeric / frames Fn), so the UNION
  // never produces two rows with the same code.
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const details = touchDetails ?? {};
  return codes
    .map((code): SignalTouch | null => {
      const r = byCode.get(code);
      const d = details[code];
      if (!r) {
        // Drift: the code no longer names a live claim/bridge. Admins see it flagged so
        // they can fix the signal; guests never see a broken link.
        return personal
          ? {
              code, type: 'claim', statement: 'This code no longer resolves to a claim or bridge-claim.',
              domain: null, confidence_label: null, href: '#',
              direction: d?.direction ?? null, reason: null, unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        type: r.type,
        statement: r.statement,
        domain: r.domain,
        confidence_label: personal ? r.confidence_label : null,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
        direction: d?.direction ?? null,
        reason: personal ? (d?.reason ?? null) : null,
      };
    })
    .filter((t): t is SignalTouch => t !== null);
}

export async function getSignal(
  id: string, personal: boolean
): Promise<{ signal: Signal; touches: SignalTouch[] } | null> {
  const signal = await one<Signal>(
    // brief/counterpoint (cached AI analysis, migration 0022) are read here only — kept off
    // SIGNAL_COLUMNS so the feed/digest payloads stay lean. They are public (no personal layer).
    `select ${SIGNAL_COLUMNS}, s.touch_details, s.brief, s.counterpoint
       from signals s
       left join sources src on src.id = s.source_id
      where s.id = $1`,
    [id]
  );
  if (!signal) return null;
  const touches = await resolveTouches(signal.claim_touches, signal.touch_details, personal);
  // touch_details (the model's reasons) is personal-layer — keep it off the wire for guests.
  if (!personal) signal.touch_details = undefined;
  return { signal, touches };
}

// Reverse lookup: every signal whose claim_touches names this code (GIN-backed). Drafts
// are admin-only; guests see published signals. Powers the claim/bridge "Related signals"
// cross-link to the Signal Board.
export async function getSignalsTouchingClaim(code: string, personal: boolean): Promise<Signal[]> {
  const where = ['s.claim_touches @> array[$1]::text[]'];
  if (!personal) where.push('s.is_published = true');
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where ${where.join(' and ')}
      order by s.published_at desc, s.created_at desc`,
    [code]
  );
}

// "In context": other signals that touch any of the SAME claim/bridge codes as this one,
// so a development on the detail page reads as part of an ongoing story. GIN array-overlap
// (`&&`) on claim_touches, self excluded, gated to published for guests (like everywhere).
// Returns [] when the signal touches nothing.
export async function getRelatedSignals(
  signalId: string, codes: string[], personal: boolean
): Promise<Signal[]> {
  if (!codes || !codes.length) return [];
  const where = ['s.id <> $1', 's.claim_touches && $2::text[]'];
  if (!personal) where.push('s.is_published = true');
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where ${where.join(' and ')}
      order by s.published_at desc, s.created_at desc`,
    [signalId, codes]
  );
}

// ---- Report generation (Phase 1: data layer) -------------------------------
// Period-scoped reads behind the /report generator. The composer (lib/report.ts)
// assembles these into a Report. Row types are co-located with their queries (like
// SummaryInput / EvidenceGraph elsewhere in this file).

// One row of the period funnel aggregate. `lens` is null for the GROUPING SETS grand-
// total row (the () grouping); a slug for each per-lens row.
export interface ReportFunnelRow {
  lens: SignalLens | null;
  candidates: number;
  approved: number;
  rejected: number;
  duplicate: number;
  drafted: number;
  discarded: number;
  published: number;
}

// One resolved touched code with its in-range signal count (input shape for the union).
interface ReportTouchCountRow {
  code: string;
  type: 'claim' | 'bridge_claim';
  statement: string;
  domain: Domain | null;
  confidence_label: ConfidenceLabel;
  signal_count: number;
}

// Period pipeline funnel anchored on discovery time (signal_candidates.retrieved_at),
// half-open at the end day. GROUPING SETS returns the overall total (lens null) AND a row
// per lens in ONE pass, so the overall and per-lens counts can never disagree. Counts
// only (::int — node-pg hands int4 back as JS numbers); rates are derived in code.
// signal_candidates.lens is a single enum (not an array), so per-lens rows are mutually
// exclusive and sum to the overall. Mirrors getPipelineAnalytics's trusted FILTER idiom
// (counts the candidate rows directly, never the drift-prone pipeline_runs.*_count tallies).
export async function getReportFunnel(from: string, to: string): Promise<ReportFunnelRow[]> {
  return q<ReportFunnelRow>(
    `select sc.lens::text as lens,
            count(*)::int                                                              as candidates,
            count(*) filter (where sc.triage_status = 'approved')::int                 as approved,
            count(*) filter (where sc.triage_status = 'rejected'
                              and sc.analysis_status <> 'discarded')::int              as rejected,
            count(*) filter (where sc.triage_status = 'duplicate')::int                as duplicate,
            count(*) filter (where sc.analysis_status = 'drafted')::int                as drafted,
            count(*) filter (where sc.analysis_status = 'discarded')::int              as discarded,
            count(distinct sig.id) filter (where sig.is_published)::int                as published
       from signal_candidates sc
       left join signals sig on sig.id = sc.signal_id
      where sc.retrieved_at >= $1::date
        and sc.retrieved_at <  ($2::date + 1)
      group by grouping sets ( (sc.lens), () )`,
    [from, to]
  );
}

// Resolve the DISTINCT set of claim/bridge codes the period's signals touch, with the
// count of in-range signals touching each. Same UNION + drift rules as resolveTouches
// (admin sees `unresolved`; guests get broken links filtered out, confidence_label
// nulled), but period-scoped — no per-signal direction/reason; carries signal_count and
// sorts by count desc. `counts` is code → in-range signal count (built by the composer
// from the signals it already fetched, so there is no second signals read).
export async function resolvePeriodTouches(
  counts: Map<string, number>,
  personal: boolean
): Promise<ReportTouch[]> {
  const codes = [...counts.keys()];
  if (!codes.length) return [];
  const rows = await q<ReportTouchCountRow>(
    `select code, 'claim'::text as type, statement, domain::text as domain, confidence_label
       from claims where code = any($1)
     union all
     select code, 'bridge_claim'::text as type, statement, domain_from::text as domain, confidence_label
       from bridge_claims where code = any($1)`,
    [codes]
  );
  // Bare-code keying is safe: claim and bridge-claim code namespaces are disjoint by
  // construction, so the UNION never produces two rows with the same code.
  const byCode = new Map(rows.map((r) => [r.code, r]));
  return codes
    .map((code): ReportTouch | null => {
      const r = byCode.get(code);
      const n = counts.get(code) ?? 0;
      if (!r) {
        // Drift: the code no longer names a live claim/bridge. Admins see it flagged;
        // guests never see a broken link.
        return personal
          ? {
              code, type: 'claim', statement: 'This code no longer resolves to a claim or bridge-claim.',
              domain: null, confidence_label: null, href: '#', signal_count: n, unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        type: r.type,
        statement: r.statement,
        domain: r.domain,
        confidence_label: personal ? r.confidence_label : null,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
        signal_count: n,
      };
    })
    .filter((t): t is ReportTouch => t !== null)
    .sort((a, b) => b.signal_count - a.signal_count || a.code.localeCompare(b.code));
}

// Saved reports (persistence). The full Report lives in the jsonb `data` column (node-pg
// returns it already parsed); list reads return only metadata for the saved-reports list.
export async function listSavedReports(): Promise<SavedReportMeta[]> {
  return q<SavedReportMeta>(
    `select id, title,
            to_char(date_from, 'YYYY-MM-DD') as date_from,
            to_char(date_to, 'YYYY-MM-DD')   as date_to,
            lenses::text[] as lenses,
            generated_at::text as generated_at,
            updated_at::text   as updated_at
       from reports
      order by updated_at desc`
  );
}

export async function getSavedReport(id: string): Promise<{ id: string; title: string; report: Report } | null> {
  const row = await one<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports where id = $1`,
    [id]
  );
  return row ? { id: row.id, title: row.title, report: row.data } : null;
}

// The most recent saved reports with their full data (the grounding corpus for the
// argument-map gap diagnosis — the model reads recent reports as evidence).
export async function getRecentReports(limit = 2): Promise<{ id: string; title: string; data: Report }[]> {
  return q<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit $1`,
    [limit]
  );
}

// The most recently saved report (powers the public "Read the latest report" link on home).
export async function getLatestSavedReport(): Promise<{ id: string; title: string; report: Report } | null> {
  const row = await one<{ id: string; title: string; data: Report }>(
    `select id, title, data from reports order by updated_at desc limit 1`
  );
  return row ? { id: row.id, title: row.title, report: row.data } : null;
}

// ---- Home dashboard (app/page.tsx) -----------------------------------------
// The landing surface: top claims/signals, pipeline analytics, a browsable candidate
// archive, and a light map-health strip. Evidence counts are structural (public);
// confidence is personal-layer (nulled for guests). The pipeline analytics + archive
// are public operational metadata (no personal-layer fields).

// Claims ranked by how much evidence is attached. Inner join => only claims with ≥1
// evidence row surface (the point of "top claims"). Frames carry no evidence.
export async function getTopClaims(personal: boolean, limit = 6): Promise<TopClaim[]> {
  const rows = await q<TopClaim>(
    `select c.id, c.code, c.statement, c.domain::text as domain,
            c.confidence, c.confidence_label,
            count(ev.id)::int as evidence_count,
            count(*) filter (where ev.direction = 'supports')::int   as supports,
            count(*) filter (where ev.direction = 'contradicts')::int as contradicts,
            count(*) filter (where ev.direction = 'neutral')::int     as neutral
       from claims c
       join evidence ev on ev.target_type = 'claim' and ev.target_id = c.id
      where c.is_frame = false
      group by c.id
      order by evidence_count desc, c.code
      limit $1`,
    [limit]
  );
  // Confidence is the personal layer; evidence counts stay (they're structural).
  return personal ? rows : rows.map((r) => ({ ...r, confidence: null, confidence_label: null }));
}

// The most recently published signals, richer-in-touches first within the recency band.
// Published-only for everyone (the panel is "latest published"); the feed card shows no
// confidence, so there's nothing further to strip.
export async function getTopSignals(limit = 6): Promise<Signal[]> {
  return q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = true
      order by s.published_at desc, cardinality(s.claim_touches) desc, s.created_at desc
      limit $1`,
    [limit]
  );
}

// A light, public orientation strip. One grouped query for the claim-evidence shape,
// plus a published-signal count. `contested` (confidence-derived) is admin-only.
export async function getMapHealth(personal: boolean): Promise<MapHealth> {
  const row = await one<{
    claims: number; uncovered: number; one_sided: number; evidence: number; contested: number;
  }>(`
    with claim_ev as (
      select c.id, c.confidence_label,
             count(ev.id) as n,
             count(*) filter (where ev.direction = 'supports')   as sup,
             count(*) filter (where ev.direction = 'contradicts') as con
        from claims c
        left join evidence ev on ev.target_type = 'claim' and ev.target_id = c.id
       where c.is_frame = false
       group by c.id
    )
    select
      (select count(*) from claim_ev)::int as claims,
      (select count(*) from claim_ev where n = 0)::int as uncovered,
      (select count(*) from claim_ev where (sup >= 2 and con = 0) or (con >= 2 and sup = 0))::int as one_sided,
      (select count(*) from evidence)::int as evidence,
      (select count(*) from claim_ev where confidence_label = 'contested')::int as contested
  `);
  const sig = await one<{ n: number }>(
    `select count(*)::int as n from signals where is_published = true`
  );
  return {
    claims: row?.claims ?? 0,
    uncovered: row?.uncovered ?? 0,
    oneSided: row?.one_sided ?? 0,
    evidence: row?.evidence ?? 0,
    signalsPublished: sig?.n ?? 0,
    contested: personal ? (row?.contested ?? 0) : null,
  };
}

// Pipeline operations analytics (public per the dashboard's visibility choice — these are
// aggregate counts, not personal-layer data). Five parallel reads: runs (with published +
// analysis-status tallies), per-run×lens counts, per-run triage breakdown, and a lens
// performance aggregate. timestamptz cast to text so the type stays honest over the wire.
export async function getPipelineAnalytics(): Promise<PipelineAnalytics> {
  const [runs, perRunLens, triage, lensPerformance, impact] = await Promise.all([
    q<PipelineRunPoint>(
      `select r.id, r.triggered_at::text as triggered_at,
              r.cadence::text as cadence, r.status::text as status, r.step::text as step,
              r.candidate_count, r.approved_count, r.signal_count,
              count(distinct sig.id) filter (where sig.is_published and sc.archived_at is null)::int   as published_count,
              count(sc.id) filter (where sc.analysis_status = 'drafted'   and sc.archived_at is null)::int as drafted,
              count(sc.id) filter (where sc.analysis_status = 'error'     and sc.archived_at is null)::int as errored,
              count(sc.id) filter (where sc.analysis_status = 'discarded' and sc.archived_at is null)::int as discarded
         from pipeline_runs r
         left join signal_candidates sc on sc.run_id = r.id
         left join signals sig on sig.id = sc.signal_id
        where r.cadence <> 'source'
        group by r.id
        order by r.triggered_at asc`
    ),
    q<RunLensCount>(
      `select sc.run_id, sc.lens::text as lens,
              count(*)::int as candidates,
              count(distinct sig.id) filter (where sig.is_published)::int as published
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
        group by sc.run_id, sc.lens`
    ),
    q<RunTriageBreakdown>(
      // Archived candidates (migration 0013) are excluded from every triage bucket here too, so
      // the per-run triage funnel and the conversion-rate trends stay consistent with the
      // funnel-composition view (which treats archived as its own segment, out of the buckets).
      `select run_id,
              count(*) filter (where triage_status = 'pending'  and archived_at is null)::int as pending,
              count(*) filter (where triage_status = 'approved' and archived_at is null)::int as approved,
              count(*) filter (where triage_status = 'rejected' and analysis_status <> 'discarded' and archived_at is null)::int as rejected,
              count(*) filter (where triage_status = 'duplicate' and archived_at is null)::int as duplicate,
              count(*) filter (where analysis_status = 'discarded' and archived_at is null)::int as discarded
         from signal_candidates
        group by run_id`
    ),
    q<LensPerformance>(
      // candidates counts everything (the funnel denominator). archived (migration 0013) is its
      // own segment, so every other bucket excludes archived_at — an archived candidate leaves
      // pending/approved/rejected/duplicate and lands only in `archived`, keeping the partition exact.
      `select sc.lens::text as lens,
              count(*)::int as candidates,
              count(*) filter (where sc.triage_status = 'pending'   and sc.archived_at is null)::int as pending,
              count(*) filter (where sc.triage_status = 'approved'  and sc.archived_at is null)::int as approved,
              count(*) filter (where sc.triage_status = 'rejected' and sc.analysis_status <> 'discarded' and sc.archived_at is null)::int as rejected,
              count(*) filter (where sc.triage_status = 'duplicate' and sc.archived_at is null)::int as duplicate,
              count(*) filter (where sc.analysis_status = 'drafted' and sc.archived_at is null)::int as drafted,
              count(distinct sig.id) filter (where sig.is_published and sc.archived_at is null)::int as published,
              count(*) filter (where sc.triage_status = 'approved' and sig.is_published and sc.archived_at is null)::int as published_candidates,
              count(*) filter (where sc.archived_at is not null)::int as archived
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
        group by sc.lens`
    ),
    // Downstream impact: argument-map targets touched by published-signal evidence. Evidence
    // with signal_id set exists only while its signal is published (syncSignalEvidence removes
    // it on unpublish; signal_id cascades on delete), so signal_id-not-null == currently live.
    // One evidence row per signal×target, so count(*) per direction == signals per direction.
    q<PipelineImpact>(
      `select e.target_type::text as target_type,
              e.target_id::text as target_id,
              coalesce(c.code, b.code) as code,
              coalesce(c.statement, b.statement) as label,
              count(distinct e.signal_id)::int as signals,
              count(*) filter (where e.direction = 'supports')::int    as supports,
              count(*) filter (where e.direction = 'contradicts')::int as contradicts,
              count(*) filter (where e.direction = 'neutral')::int     as neutral
         from evidence e
         left join claims c        on e.target_type = 'claim'        and c.id = e.target_id
         left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
        where e.signal_id is not null
        -- each (target_type,target_id) resolves to exactly one claim XOR bridge_claim, so c.* / b.*
        -- are functionally dependent on target_id; the coalesce in select picks the non-null side.
        group by e.target_type, e.target_id, c.code, b.code, c.statement, b.statement
        order by count(distinct e.signal_id) desc, count(*) desc`
    ),
  ]);

  const totals = runs.reduce(
    (acc, r) => ({
      runs: acc.runs,
      candidates: acc.candidates + r.candidate_count,
      approved: acc.approved + r.approved_count,
      drafted: acc.drafted + r.drafted,
      published: acc.published + r.published_count,
      errored: acc.errored + r.errored,
      discarded: acc.discarded + r.discarded,
    }),
    { runs: runs.length, candidates: 0, approved: 0, drafted: 0, published: 0, errored: 0, discarded: 0 }
  );

  return { runs, perRunLens, triage, lensPerformance, impact, totals };
}

// The browsable candidate archive: every discovered candidate, filterable/searchable/
// paginated. Dynamic WHERE built param-safely (like getSignals). `dateField` is whitelisted
// to a literal column name (never raw user text); the search term is parameterized and its
// LIKE wildcards escaped. count(*) over() returns the unfiltered-by-page total in one trip.
export async function getCandidateArchive(f: CandidateArchiveFilters): Promise<CandidateArchiveResult> {
  const where: string[] = [];
  const whereParams: unknown[] = [];
  if (f.lens) { whereParams.push(f.lens); where.push(`sc.lens = $${whereParams.length}::signal_lens_t`); }
  if (f.triage_status) { whereParams.push(f.triage_status); where.push(`sc.triage_status = $${whereParams.length}::triage_status_t`); }
  const dateCol = f.dateField === 'published_date' ? 'sc.published_date' : 'sc.retrieved_at';
  if (f.from) { whereParams.push(f.from); where.push(`${dateCol} >= $${whereParams.length}::date`); }
  if (f.to) { whereParams.push(f.to); where.push(`${dateCol} <= $${whereParams.length}::date`); }
  if (f.search) {
    const term = `%${f.search.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`;
    whereParams.push(term);
    where.push(`(sc.headline ilike $${whereParams.length} or sc.url ilike $${whereParams.length})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);

  const [rows, totalRow] = await Promise.all([
    q<CandidateArchiveRow>(
      `select sc.id, sc.run_id, sc.url, sc.headline, sc.source_domain, sc.lens::text as lens,
              to_char(sc.published_date, 'YYYY-MM-DD') as published_date, sc.retrieved_at::text as retrieved_at,
              sc.triage_status::text as triage_status, sc.triage_reason,
              sc.analysis_status::text as analysis_status, sc.signal_id,
              sig.is_published as signal_published,
              sc.archived_at::text as archived_at
         from signal_candidates sc
         left join signals sig on sig.id = sc.signal_id
         ${clause}
        order by sc.retrieved_at desc
        limit $${whereParams.length + 1} offset $${whereParams.length + 2}`,
      [...whereParams, pageSize, (page - 1) * pageSize]
    ),
    one<{ n: number }>(
      `select count(*)::int as n from signal_candidates sc ${clause}`,
      whereParams
    ),
  ]);
  return { rows, total: totalRow?.n ?? 0, page, pageSize };
}

// ---- Discovery pipeline (admin-only reads) ---------------------------------
// raw_content (potentially large) is omitted from list reads and fetched only per
// candidate during analysis.
// published_date is a `date` (node-pg would hand it back as a Date); to_char keeps it a
// plain 'YYYY-MM-DD' string so the type is honest and prompt/JSX use is slice-safe.
const CANDIDATE_LIST_COLUMNS = `
  id, run_id, url, headline, source_domain, lens,
  to_char(published_date, 'YYYY-MM-DD') as published_date, retrieved_at,
  triage_status, triage_reason, signal_id, source_id, analysis_status, analysis_error,
  archived_at::text as archived_at, created_at, updated_at`;

export async function getRun(id: string): Promise<PipelineRun | null> {
  return one<PipelineRun>(`select * from pipeline_runs where id = $1`, [id]);
}

export async function getRuns(limit = 20): Promise<PipelineRun[]> {
  // Discovery runs only — single-source ('source') runs are an implementation detail of the
  // manual "Turn into signal" flow and would otherwise flood the history / "latest run" panel.
  return q<PipelineRun>(
    `select * from pipeline_runs where cadence <> 'source' order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getCandidates(runId: string): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates where run_id = $1
      order by lens, triage_status, retrieved_at`,
    [runId]
  );
}

export async function getCandidate(id: string): Promise<SignalCandidate | null> {
  return one<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, raw_content from signal_candidates where id = $1`,
    [id]
  );
}

export async function getApprovedCandidates(runId: string): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates
      where run_id = $1 and triage_status = 'approved'
      order by lens, retrieved_at`,
    [runId]
  );
}

// ---- Learning loop (migration 0016) ----------------------------------------
// The pipeline's own funnel history, per source domain. Decided candidates only
// (pending excluded) so a run can never bias against a domain it just discovered.
// "approved" counts the original triage decision: candidates later flagged
// 'unanalyzable:' were approved first, then flipped to rejected by the give-up path.
interface DomainStat {
  domain: string;
  seen: number;
  approved: number;
  drafted: number;
  duplicate: number;
  unanalyzable: number;
}

export async function getDomainStats(minSeen = 2): Promise<DomainStat[]> {
  return q<DomainStat>(
    `select regexp_replace(lower(source_domain), '^www\\.', '') as domain,
            count(*)::int as seen,
            count(*) filter (where triage_status = 'approved' or triage_reason like 'unanalyzable:%')::int as approved,
            count(*) filter (where analysis_status = 'drafted')::int as drafted,
            count(*) filter (where triage_status = 'duplicate')::int as duplicate,
            count(*) filter (where triage_reason like 'unanalyzable:%')::int as unanalyzable
       from signal_candidates
      where source_domain is not null and source_domain <> '' and triage_status <> 'pending'
      group by 1
     having count(*) >= $1
      order by count(*) desc`,
    [minSeen]
  );
}

// Domains discovery keeps surfacing and triage never approves — SEO farms by observed
// behavior. Fed into the web_search tool's blocked_domains so they stop entering the
// funnel (and stop costing triage tokens) at all. Three guardrails (the Kimi-K3 audit):
// duplicates are YIELD, not churn (a dupe means the domain carried a real story we
// already track — this once blocked occ.gov, whose candidates were 5/6 duplicates);
// primary-source infrastructure and major wires can never be auto-blocked (huggingface.co
// had qualified on five rejected community-blog posts); and only the trailing 90 days
// count, so a blocked domain that starts yielding can redeem itself once its old
// rejections age out (a blocked domain never re-enters the funnel, so without decay the
// block was permanent).
export async function getZeroYieldDomains(minSeen = 4, limit = 30): Promise<string[]> {
  const rows = await q<{ domain: string }>(
    `select regexp_replace(lower(source_domain), '^www\\.', '') as domain
       from signal_candidates
      where source_domain is not null and source_domain <> '' and triage_status <> 'pending'
        and created_at > now() - interval '90 days'
      group by 1
     having count(*) >= $1
        and count(*) filter (where triage_status = 'approved' or triage_reason like 'unanalyzable:%') = 0
        and count(*) filter (where triage_status = 'duplicate') = 0
      order by count(*) desc
      limit $2`,
    [minSeen, limit]
  );
  return rows.map((r) => r.domain).filter((d) => !isNeverAutoBlocked(d));
}

// Should hydration skip the (historically doomed) direct fetch for this domain and go
// straight to the reader? True when the domain has needed the reader before, or has
// terminally access-walled a direct fetch, AND has never succeeded directly.
export async function isFetchHostileDomain(domain: string): Promise<boolean> {
  const row = await one<{ hostile: boolean; direct_ok: boolean }>(
    `select
       exists(select 1 from signal_candidates
               where regexp_replace(lower(source_domain), '^www\\.', '') = $1
                 and (fetched_via = 'jina'
                      or analysis_error ~* '^HTTP 40[13]'
                      or triage_reason ~* '^unanalyzable: (HTTP 40[13]|reader|page returned too little)')) as hostile,
       exists(select 1 from signal_candidates
               where regexp_replace(lower(source_domain), '^www\\.', '') = $1
                 and fetched_via = 'direct') as direct_ok`,
    [domain]
  );
  return !!row && row.hostile && !row.direct_ok;
}

// Triage processes pending candidates one bounded chunk per server-action call (each its
// own 60s budget). This fetches the next chunk; writing decisions moves them out of
// 'pending', so repeated calls drain the queue (and resume a partially-triaged run).
export async function getPendingCandidates(runId: string, limit: number): Promise<SignalCandidate[]> {
  return q<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates
      where run_id = $1 and triage_status = 'pending' and archived_at is null
      order by lens, retrieved_at
      limit $2`,
    [runId, limit]
  );
}

// Un-triaged candidates blocking the run, archived ones excluded (migration 0013): an archived
// straggler is set aside, so it neither queues for triage nor blocks the run from completing.
export async function countPendingCandidates(runId: string): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from signal_candidates where run_id = $1 and triage_status = 'pending' and archived_at is null`,
    [runId]
  );
  return row?.n ?? 0;
}

// For the discovery lookback window ("last 7 days, or since the last run"). Excludes 'source'
// runs (single manual sources) — they would otherwise shrink the next discovery window.
export async function getLastCompletedRunAt(): Promise<string | null> {
  const row = await one<{ triggered_at: string }>(
    `select triggered_at from pipeline_runs where status = 'completed' and cadence <> 'source' order by triggered_at desc limit 1`
  );
  return (row?.triggered_at as unknown as string) ?? null;
}

// Every URL already tracked: manual sources + any candidate that became a draft. Discovery
// triage flags a re-discovered URL as a duplicate against this set, so a manually-uploaded
// link never re-enters the pipeline. Small (single-user tool); loaded once per triage chunk.
export async function getKnownUrls(): Promise<string[]> {
  const rows = await q<{ url: string }>(
    `select url from sources where url is not null and url <> ''
     union
     select url from signal_candidates where signal_id is not null and url is not null and url <> ''`
  );
  return rows.map((r) => r.url);
}

// Idempotency for the manual "Turn into signal" flow: the most recent candidate for a source
// (if any), so a repeat click resumes it instead of creating a second run/candidate.
export async function getCandidateBySourceId(sourceId: string): Promise<SignalCandidate | null> {
  return one<SignalCandidate>(
    `select ${CANDIDATE_LIST_COLUMNS}, null::text as raw_content
       from signal_candidates where source_id = $1
      order by created_at desc limit 1`,
    [sourceId]
  );
}

// Has this source already produced a signal? (Covers both the new candidate flow and any
// pre-refactor manual signal created directly with a source_id.)
export async function getSignalIdBySource(sourceId: string): Promise<string | null> {
  const row = await one<{ id: string }>(
    `select id from signals where source_id = $1 order by created_at limit 1`,
    [sourceId]
  );
  return row?.id ?? null;
}

// Triage context: existing signals (title + ISO date) for semantic dedup, and the
// admin's already-rated source outlets so triage can lean on prior human reliability
// judgments. Both kept small — they feed a single triage prompt.
export async function getSignalsDigestForTriage(): Promise<{
  signals: { id: string; title: string; published_at: string | null }[];
  ratedSources: { outlet: string; reliability_prior: number }[];
}> {
  const signals = await q<{ id: string; title: string; published_at: string | null }>(
    `select id, title, to_char(published_at, 'YYYY-MM-DD') as published_at
       from signals order by published_at desc limit 200`
  );
  const ratedSources = await q<{ outlet: string; reliability_prior: number }>(
    `select outlet, reliability_prior from sources
      where reliability_prior is not null and outlet is not null and btrim(outlet) <> ''
      order by reliability_prior desc limit 60`
  );
  return { signals, ratedSources };
}

// ---- AI cost dashboard (/costs, admin-only; migration 0014) -----------------
// Every aggregate for the cost console in one parallel trip-set. Costs are read straight off
// the FROZEN cost_usd column (priced at call time), never recomputed here. camelCase result
// keys are double-quoted in SQL so they survive Postgres's lowercasing and match the types.
export async function getCostDashboard(): Promise<CostDashboard> {
  const [summaryRow, daily60, features, runs, recent, activeRateCards, rateCardHistory] = await Promise.all([
    one<CostSummary>(
      `select count(*)::int as calls,
              coalesce(sum(cost_usd), 0) as total,
              coalesce(sum(cost_usd) filter (where created_at >= now() - interval '30 days'), 0) as d30,
              coalesce(sum(cost_usd) filter (where created_at >= now() - interval '7 days'), 0)  as d7,
              count(*) filter (where created_at >= now() - interval '30 days')::int as "calls30",
              count(*) filter (where created_at >= now() - interval '7 days')::int  as "calls7",
              coalesce(avg(cost_usd), 0) as "avgCost"
         from ai_cost_log`
    ),
    // 60 zero-filled days (oldest → newest): the extra 30 days of lookback make the 30-day
    // rolling mean a TRUE trailing-30 mean for every one of the 30 days we display.
    q<{ day: string; cost: number; calls: number }>(
      `with days as (
         select generate_series(current_date - interval '59 days', current_date, interval '1 day')::date as day
       ),
       agg as (
         select created_at::date as day, sum(cost_usd) as cost, count(*)::int as calls
           from ai_cost_log
          where created_at >= current_date - interval '59 days'
          group by created_at::date
       )
       select to_char(d.day, 'YYYY-MM-DD') as day,
              coalesce(a.cost, 0) as cost,
              coalesce(a.calls, 0) as calls
         from days d left join agg a on a.day = d.day
        order by d.day`
    ),
    q<FeatureCost>(
      `select feature,
              count(*)::int as calls,
              coalesce(sum(cost_usd), 0) as "totalCost",
              coalesce(avg(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) as "avgTokens",
              coalesce(avg(input_tokens), 0)  as "avgInput",
              coalesce(avg(output_tokens), 0) as "avgOutput",
              coalesce(avg(context_pct), 0)   as "avgContextPct",
              coalesce(percentile_cont(0.5)  within group (order by cost_usd), 0) as p50,
              coalesce(percentile_cont(0.9)  within group (order by cost_usd), 0) as p90,
              coalesce(percentile_cont(0.99) within group (order by cost_usd), 0) as p99
         from ai_cost_log
        group by feature
        order by "totalCost" desc`
    ),
    // Per-run rollup, last 20 runs (a pre-instrumentation run simply shows 0). tokens cast to
    // int (a run's total is well within int range) so it returns a JS number, not a bigint string.
    q<RunCost>(
      `select r.id, r.triggered_at::text as triggered_at, r.cadence::text as cadence, r.status::text as status,
              count(l.id)::int as calls,
              coalesce(sum(l.cost_usd), 0) as cost,
              coalesce(sum(l.input_tokens + l.output_tokens + l.cache_read_tokens + l.cache_write_tokens), 0)::int as tokens
         from pipeline_runs r
         left join ai_cost_log l on l.pipeline_run_id = r.id
        group by r.id
        order by r.triggered_at desc
        limit 20`
    ),
    q<CostLogRow>(
      `select l.id, l.created_at::text as created_at, l.feature, l.model,
              l.input_tokens, l.output_tokens, l.cache_read_tokens, l.cache_write_tokens,
              l.wall_ms, l.context_pct, l.cost_usd,
              l.pipeline_run_id::text as pipeline_run_id
         from ai_cost_log l
        order by l.created_at desc
        limit 100`
    ),
    // Active card per model: the latest effective_date on-or-before today (a future-dated card
    // is not active yet). distinct on (model) + the matching order picks it in one pass.
    q<RateCard>(
      `select distinct on (model)
              id, model, effective_date::text as effective_date,
              input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok,
              context_window, created_at::text as created_at
         from ai_rate_cards
        where effective_date <= current_date
        order by model, effective_date desc, created_at desc`
    ),
    q<RateCard>(
      `select id, model, effective_date::text as effective_date,
              input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok,
              context_window, created_at::text as created_at
         from ai_rate_cards
        order by model asc, effective_date desc, created_at desc`
    ),
  ]);

  // Rolling means over the 60-day series, then keep the last 30 days for display.
  const series = daily60 as { day: string; cost: number; calls: number }[];
  const trailingMean = (i: number, n: number): number => {
    const start = Math.max(0, i - n + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += series[j].cost;
    return sum / (i - start + 1);
  };
  const daily: DailyCostPoint[] = series
    .map((d, i) => ({ day: d.day, cost: d.cost, calls: d.calls, avg7: trailingMean(i, 7), avg30: trailingMean(i, 30) }))
    .slice(-30);

  const summary: CostSummary =
    summaryRow ?? { calls: 0, total: 0, d30: 0, d7: 0, calls30: 0, calls7: 0, avgCost: 0 };

  return { summary, daily, features, runs, recent, activeRateCards, rateCardHistory };
}

// ---------------------------------------------------------------- concepts (the semantic scaffold)
// Public reads. Concepts carry no personal layer of their own — only the claim
// links resolve into confidence words, which are stripped for guests like
// everywhere else. Both link tables are filtered to status='confirmed' so a
// future 'suggested' queue could never leak into the public graph.

export async function getConceptGraph(): Promise<ConceptGraphData> {
  const [concepts, edges] = await Promise.all([
    q<Concept>(`select * from concepts order by name`),
    q<ConceptEdge>(
      `select concept_id, prerequisite_id from concept_edges where status = 'confirmed'`
    ),
  ]);
  return { concepts, edges };
}

export async function getConcept(slug: string, personal: boolean): Promise<ConceptDetail | null> {
  const concept = await one<Concept>(`select * from concepts where slug = $1`, [slug]);
  if (!concept) return null;

  const [prerequisites, dependents, links] = await Promise.all([
    q<ConceptRef>(
      `select c.id, c.slug, c.name, c.short_definition, c.status
         from concept_edges e join concepts c on c.id = e.prerequisite_id
        where e.concept_id = $1 and e.status = 'confirmed'
        order by c.name`,
      [concept.id]
    ),
    q<ConceptRef>(
      `select c.id, c.slug, c.name, c.short_definition, c.status
         from concept_edges e join concepts c on c.id = e.concept_id
        where e.prerequisite_id = $1 and e.status = 'confirmed'
        order by c.name`,
      [concept.id]
    ),
    q<{ target_type: 'claim' | 'bridge_claim'; target_code: string }>(
      `select target_type, target_code from concept_claims
        where concept_id = $1 and status = 'confirmed'
        order by target_code`,
      [concept.id]
    ),
  ]);

  // Resolve the stored codes against the live map (mirrors resolveTouches): an
  // admin sees a dangling code flagged; a guest never sees a broken link.
  const codes = links.map((l) => l.target_code);
  const rows = codes.length
    ? await q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; confidence_label: ConfidenceLabel }>(
        `select code, 'claim'::text as type, statement, confidence_label
           from claims where code = any($1)
         union all
         select code, 'bridge_claim'::text as type, statement, confidence_label
           from bridge_claims where code = any($1)`,
        [codes]
      )
    : [];
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.code}`, r]));
  const claims = links
    .map((l): ConceptClaimLink | null => {
      const r = byKey.get(`${l.target_type}:${l.target_code}`);
      if (!r) {
        return personal
          ? {
              code: l.target_code, type: l.target_type,
              statement: 'This code no longer resolves to a claim or bridge-claim.',
              confidence_label: null, href: '#', unresolved: true,
            }
          : null;
      }
      return {
        code: r.code,
        type: r.type,
        statement: r.statement,
        confidence_label: personal ? r.confidence_label : null,
        href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
      };
    })
    .filter((x): x is ConceptClaimLink => x !== null);

  return { concept, prerequisites, dependents, claims };
}

// Edit-form read: the raw row plus its prerequisite ids and claim codes (admin-only
// caller; no status filter so nothing the form writes can be invisible to it).
export async function getConceptForEdit(slug: string): Promise<{
  concept: Concept;
  prerequisite_ids: string[];
  claim_codes: string[];
} | null> {
  const concept = await one<Concept>(`select * from concepts where slug = $1`, [slug]);
  if (!concept) return null;
  const [prereqs, links] = await Promise.all([
    q<{ prerequisite_id: string }>(
      `select prerequisite_id from concept_edges where concept_id = $1`,
      [concept.id]
    ),
    q<{ target_code: string }>(
      `select target_code from concept_claims where concept_id = $1 order by target_code`,
      [concept.id]
    ),
  ]);
  return {
    concept,
    prerequisite_ids: prereqs.map((r) => r.prerequisite_id),
    claim_codes: links.map((r) => r.target_code),
  };
}

// The persisted concept gap scan (singleton), or null if none.
export async function getConceptGapScan(): Promise<ConceptGapScan | null> {
  const row = await one<{ recommendation: ConceptGapScan }>(
    `select recommendation from concept_gap_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop recommendations whose slug now names a live concept (created since the scan),
// so a persisted scan never re-recommends something that exists. Pure (no DB),
// mirroring reconcileDedupeScan.
export function reconcileConceptGapScan(
  scan: ConceptGapScan | null, liveSlugs: Set<string>
): ConceptGapScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveSlugs.has(r.slug));
  return recommendations.length ? { ...scan, recommendations } : null;
}

// ---- Argument-map node authoring (claims + bridges; migration 0021) ----------

// Every stance the author can wire a new claim to, with its owning question's slug
// (for routing a claim draft to /q/<slug>/claim/new) and sort order (for code
// suggestion). The non-frame claim picker reuses getTargets(); bridges too.
interface StanceOption {
  id: string;
  code: string;
  title: string;
  question_slug: string;
  question_sort: number;
}

export async function getStanceOptions(): Promise<StanceOption[]> {
  return q<StanceOption>(
    `select s.id, s.code, s.title, qn.slug as question_slug, qn.sort_order as question_sort
       from stances s join questions qn on qn.id = s.question_id
      order by qn.sort_order, s.sort_order`
  );
}

// Suggest the next free claim code in the seed convention "<questionSort>.<n>"
// (e.g. question 3 -> '3.6'). The unique constraint is the backstop; this is only a
// convenience default the admin can overwrite.
export function nextClaimCode(questionSort: number, existingCodes: string[]): string {
  const prefix = `${questionSort}.`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const minor = Number(code.slice(prefix.length));
    if (Number.isInteger(minor) && minor > max) max = minor;
  }
  return `${prefix}${max + 1}`;
}

// Suggest the next free bridge code in the seed convention "B<n>" (e.g. 'B5').
export function nextBridgeCode(existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    const mt = /^B(\d+)$/.exec(code);
    if (mt) {
      const n = Number(mt[1]);
      if (n > max) max = n;
    }
  }
  return `B${max + 1}`;
}

// The persisted argument-map gap scan (singleton), or null if none.
export async function getArgumentGapScan(): Promise<ArgumentGapScan | null> {
  const row = await one<{ recommendation: ArgumentGapScan }>(
    `select recommendation from argument_gap_scan where id = true`
  );
  return row?.recommendation ?? null;
}

// Drop recommendations whose proposed code now names a live claim/bridge (created
// since the scan), so a persisted scan never re-recommends something that exists.
// Pure (no DB), mirroring reconcileConceptGapScan.
export function reconcileArgumentGapScan(
  scan: ArgumentGapScan | null, liveCodes: Set<string>
): ArgumentGapScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveCodes.has(r.code));
  return recommendations.length ? { ...scan, recommendations } : null;
}

// ===== Research section (migration 0023) =====================================
// Admin-first surface: no personal-layer stripping yet — every getter here is
// called from admin-gated pages/actions. When /research goes public, review_*,
// rigor_prior, and triage internals become the layer to strip.

// List reads omit the heavy columns (raw_content, extraction) — same discipline as
// signal_candidates. Dates cast to text (pg returns `date` as a JS Date otherwise).
const PAPER_LIST_COLUMNS = `
  id, origin, arxiv_id, url, run_id, source_id, title, abstract, authors, categories,
  comments, arxiv_version,
  to_char(published_at, 'YYYY-MM-DD') as published_at,
  to_char(arxiv_updated, 'YYYY-MM-DD') as arxiv_updated,
  triage_status, triage_reason, triage_summary, claim_touches, suggested_concepts, suggested_threads,
  fetched_via, rigor_prior, review_status, review_note, reviewed_at, signal_id,
  citation_count, citations_checked_at, author_hindex,
  agent_recommendation, agent_reason, agent_confidence, agent_cluster, agent_at::text as agent_at,
  created_at, updated_at`;

export async function getResearchRuns(limit = 15): Promise<ResearchRun[]> {
  return q<ResearchRun>(
    `select id, triggered_at, status, step, to_char(since_date, 'YYYY-MM-DD') as since_date,
            scanned_count, pulled_count, kept_count, rejected_count, error, created_at, updated_at
       from research_runs order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getLastResearchRunAt(): Promise<string | null> {
  const row = await one<{ triggered_at: string }>(
    `select triggered_at::text as triggered_at from research_runs
      where status = 'completed' order by triggered_at desc limit 1`
  );
  return row?.triggered_at ?? null;
}

export async function countPendingPapers(runId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*)::text as n from papers where run_id = $1 and triage_status = 'pending'`,
    [runId]
  );
  return Number(row?.n ?? 0);
}

// The review queue: triage-kept papers awaiting the human decision, newest first.
export async function getReviewQueuePapers(limit = 100): Promise<Paper[]> {
  return q<Paper>(
    `select ${PAPER_LIST_COLUMNS} from papers
      where triage_status = 'kept' and review_status = 'pending'
      order by published_at desc nulls last, created_at desc
      limit $1`,
    [limit]
  );
}

export async function getPaper(id: string): Promise<Paper | null> {
  return one<Paper>(
    `select ${PAPER_LIST_COLUMNS}, raw_content, extraction from papers where id = $1`,
    [id]
  );
}

// Triage digests: the concept and thread halves of the run-static system block.
export async function getConceptDigest(): Promise<{ slug: string; name: string; short_definition: string }[]> {
  return q(`select slug, name, short_definition from concepts order by slug`);
}

export async function getThreadDigest(): Promise<{ slug: string; title: string; question: string }[]> {
  return q(`select slug, title, question from research_threads where status = 'open' order by slug`);
}

export async function getResearchThreads(): Promise<ResearchThread[]> {
  return q<ResearchThread>(
    `select t.id, t.slug, t.title, t.question, t.synthesis, t.status, t.created_at, t.updated_at,
            (select count(*)::int from thread_papers tp where tp.thread_id = t.id) as paper_count
       from research_threads t
      order by t.status = 'open' desc, t.title`
  );
}

// Phase 2 getters: the analysis path + the paper detail page.

export async function getSourceText(sourceId: string): Promise<string | null> {
  const row = await one<{ raw_text: string | null }>(
    `select raw_text from sources where id = $1`,
    [sourceId]
  );
  return row?.raw_text ?? null;
}

// Confirmed concept links, resolved against live concepts (a dangling slug degrades
// to name=null — the drift flag, same discipline as concept_claims).
export async function getPaperConcepts(
  paperId: string
): Promise<{ slug: string; name: string | null; status: string }[]> {
  return q(
    `select pc.concept_slug as slug, c.name, pc.status
       from paper_concepts pc
       left join concepts c on c.slug = pc.concept_slug
      where pc.paper_id = $1
      order by pc.created_at`,
    [paperId]
  );
}

export async function getPaperThreads(
  paperId: string
): Promise<{ slug: string; title: string; relation: string; why: string | null; status: string }[]> {
  return q(
    `select t.slug, t.title, tp.relation, tp.why, tp.status
       from thread_papers tp
       join research_threads t on t.id = tp.thread_id
      where tp.paper_id = $1
      order by tp.created_at`,
    [paperId]
  );
}

// Phase 3: threads as pages.

export async function getThreadBySlug(slug: string): Promise<ResearchThread | null> {
  return one<ResearchThread>(
    `select id, slug, title, question, synthesis, status, created_at, updated_at
       from research_threads where slug = $1`,
    [slug]
  );
}

export async function getThreadPapers(threadId: string): Promise<ThreadPaperRow[]> {
  return q<ThreadPaperRow>(
    `select p.id, p.title, p.arxiv_id, p.url,
            to_char(p.published_at, 'YYYY-MM-DD') as published_at,
            tp.relation, tp.why, p.review_status, p.review_note,
            p.extraction->>'headline_claim' as headline,
            p.extraction->>'effect_size' as effect
       from thread_papers tp
       join papers p on p.id = tp.paper_id
      where tp.thread_id = $1 and tp.status = 'confirmed'
      order by p.published_at desc nulls last, p.created_at desc`,
    [threadId]
  );
}

export async function getThreadRevisions(
  threadId: string, limit = 10
): Promise<{ id: string; synthesis: string; trigger_note: string | null; created_at: string }[]> {
  return q(
    `select id, synthesis, trigger_note, created_at::text as created_at
       from thread_revisions where thread_id = $1
      order by created_at desc limit $2`,
    [threadId, limit]
  );
}

// The concept page's admin-only "recent research" pane: confirmed paper links.
export async function getPapersForConcept(
  slug: string, limit = 6
): Promise<{ id: string; title: string; arxiv_id: string | null; url: string; published_at: string | null; headline: string | null }[]> {
  return q(
    `select p.id, p.title, p.arxiv_id, p.url,
            to_char(p.published_at, 'YYYY-MM-DD') as published_at,
            p.extraction->>'headline_claim' as headline
       from paper_concepts pc
       join papers p on p.id = pc.paper_id
      where pc.concept_slug = $1 and pc.status = 'confirmed'
      order by p.published_at desc nulls last, p.created_at desc
      limit $2`,
    [slug, limit]
  );
}

// The thread-scan singleton, reconciled on read: a recommendation whose slug now
// exists as a live thread is dropped (it has been created since the scan).
export async function getThreadScan(): Promise<ResearchThreadScan | null> {
  const row = await one<{ recommendation: ResearchThreadScan }>(
    `select recommendation from research_thread_scan where id = true`
  );
  return row?.recommendation ?? null;
}

export function reconcileThreadScan(
  scan: ResearchThreadScan | null, liveSlugs: Set<string>
): ResearchThreadScan | null {
  if (!scan) return null;
  const recommendations = scan.recommendations.filter((r) => !liveSlugs.has(r.slug));
  return recommendations.length ? { ...scan, recommendations } : null;
}

// Phase 4: the watchlist + the citation self-correction surface.

export async function getWatchlist(limit = 60): Promise<WatchlistRow[]> {
  return q<WatchlistRow>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            review_note, reviewed_at::text as reviewed_at,
            extraction->>'headline_claim' as headline,
            citation_count, citations_checked_at::text as citations_checked_at, author_hindex, signal_id
       from papers
      where review_status = 'tracked'
      order by reviewed_at desc nulls last
      limit $1`,
    [limit]
  );
}

export async function getRisingRejects(minCitations = 5, limit = 12): Promise<RisingReject[]> {
  return q<RisingReject>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            triage_reason, review_status, citation_count
       from papers
      where citation_count >= $1
        and (triage_status = 'rejected' or review_status = 'dismissed')
      order by citation_count desc
      limit $2`,
    [minCitations, limit]
  );
}

// The research digest's two halves: papers tracked in the window, threads whose
// synthesis moved in the window.
export async function getTrackedSince(sinceISO: string | null): Promise<WatchlistRow[]> {
  return q<WatchlistRow>(
    `select id, title, arxiv_id, url,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            review_note, reviewed_at::text as reviewed_at,
            extraction->>'headline_claim' as headline,
            citation_count, citations_checked_at::text as citations_checked_at, signal_id
       from papers
      where review_status = 'tracked'
        and reviewed_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by reviewed_at desc`,
    [sinceISO]
  );
}

export async function getThreadsUpdatedSince(sinceISO: string | null): Promise<ResearchThread[]> {
  return q<ResearchThread>(
    `select t.id, t.slug, t.title, t.question, t.synthesis, t.status, t.created_at, t.updated_at,
            (select count(*)::int from thread_papers tp where tp.thread_id = t.id) as paper_count
       from research_threads t
      where t.synthesis is not null
        and t.updated_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by t.updated_at desc`,
    [sinceISO]
  );
}

// The portal's "what's new" strip: synthesis revisions in the window, with the
// trigger note as the human-readable delta. Public (trigger notes are editorial).
export async function getRecentThreadRevisions(sinceISO: string | null, limit = 8): Promise<RecentThreadRevision[]> {
  return q<RecentThreadRevision>(
    `select r.id, t.slug as thread_slug, t.title as thread_title,
            r.trigger_note, r.created_at::text as created_at
       from thread_revisions r
       join research_threads t on t.id = r.thread_id
      where r.created_at >= coalesce($1::date, (now() - interval '14 days')::date)
      order by r.created_at desc
      limit $2`,
    [sinceISO, limit]
  );
}

// Papers on the reviewed shelf whose ADVISORY touches name this claim/bridge code.
// A cross-link only: papers never write evidence (the 0023 invariant).
export async function getPapersForTarget(code: string, limit = 6): Promise<
  { id: string; title: string; arxiv_id: string | null; published_at: string | null; headline: string | null }[]
> {
  return q(
    `select id, title, arxiv_id, to_char(published_at, 'YYYY-MM-DD') as published_at,
            extraction->>'headline_claim' as headline
       from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')
        and claim_touches @> array[$1]::text[]
      order by published_at desc nulls last
      limit $2`,
    [code, limit]
  );
}

// The portal's map rollup: which claims/bridges the reviewed shelf bears on,
// resolved to statements (dangling codes keep a null href and read as drift).
export async function getResearchTouchRollup(limit = 10): Promise<
  { code: string; statement: string | null; href: string | null; paper_count: number }[]
> {
  return q(
    `with touches as (
       select unnest(claim_touches) as code
         from papers
        where triage_status = 'kept' and review_status in ('tracked', 'noted')
     )
     select t.code,
            coalesce(c.statement, b.statement) as statement,
            case when c.id is not null then '/claim/' || t.code
                 when b.id is not null then '/bridge/' || t.code
                 else null end as href,
            count(*)::int as paper_count
       from touches t
       left join claims c on c.code = t.code
       left join bridge_claims b on b.code = t.code
      group by t.code, c.id, b.id, c.statement, b.statement
      order by count(*) desc, t.code
      limit $1`,
    [limit]
  );
}

// Findings coverage over the reviewed shelf (tracked + noted). The portal leads
// with findings now, so the console surfaces which reviewed papers still lack one;
// the panel batch-analyzes them, keeping the human in front of the spend.
export async function getFindingCoverage(): Promise<{
  reviewed: number; withFinding: number; missing: { id: string; title: string }[];
}> {
  const counts = await one<{ reviewed: number; with_finding: number }>(
    `select count(*)::int as reviewed, count(extraction)::int as with_finding
       from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')`
  );
  const missing = await q<{ id: string; title: string }>(
    `select id, title from papers
      where triage_status = 'kept' and review_status in ('tracked', 'noted')
        and extraction is null
      order by (review_status = 'tracked') desc, reviewed_at desc nulls last`
  );
  return { reviewed: counts?.reviewed ?? 0, withFinding: counts?.with_finding ?? 0, missing };
}

// Noted papers, fetched directly (the old route filtered getReviewedPapers' merged
// tracked+noted list, which silently emptied Noted once tracked rows hit the cap).
export async function getNotedPapers(limit = 60): Promise<Paper[]> {
  return q<Paper>(
    `select ${PAPER_LIST_COLUMNS} from papers
      where review_status = 'noted'
      order by reviewed_at desc nulls last
      limit $1`,
    [limit]
  );
}

// ---- Thesis reports (migration 0027) ----------------------------------------
// Reads for the standing-thesis surface. The /theses console is admin-only; a saved
// thesis report (/thesis-report/[id]) is PUBLIC, so getThesisReport returns only the
// guest-safe pack + sanitized narrative that were frozen at save time.

export async function getTheses(): Promise<Thesis[]> {
  return q<Thesis>(
    `select t.id, t.statement, t.claim_codes, t.mapping_note, t.status::text as status,
            t.created_at::text as created_at, t.updated_at::text as updated_at,
            count(r.id)::int as report_count,
            max(r.generated_at)::text as last_generated_at
       from theses t
       left join thesis_reports r on r.thesis_id = t.id
      group by t.id
      order by t.status = 'active' desc, t.updated_at desc`
  );
}

export async function getThesis(id: string): Promise<Thesis | null> {
  return one<Thesis>(
    `select id, statement, claim_codes, mapping_note, status::text as status,
            created_at::text as created_at, updated_at::text as updated_at, gap_scan
       from theses where id = $1`,
    [id]
  );
}

export async function getThesisReportsMeta(thesisId: string): Promise<ThesisReportMeta[]> {
  return q<ThesisReportMeta>(
    `select id, thesis_id, title, generated_at::text as generated_at,
            coalesce((pack->'stats'->>'matched')::int, 0) as matched
       from thesis_reports
      where thesis_id = $1
      order by generated_at desc, id`,
    [thesisId]
  );
}

export async function getThesisReport(id: string): Promise<SavedThesisReport | null> {
  return one<SavedThesisReport>(
    `select id, thesis_id, title, statement, pack, narrative, generated_at::text as generated_at
       from thesis_reports where id = $1`,
    [id]
  );
}

// The theses tracking a claim/bridge code (the tear-sheet pack's reverse lookup,
// surfaced on claim/bridge pages). Guest-safe: statements are already public via
// the tracker and reports; the mapping itself carries nothing personal. Guests
// link the latest public report; only admins link /theses/[id].
interface ThesisForTarget {
  id: string;
  statement: string;
  latest_report_id: string | null;
}

export async function getThesesForTarget(code: string): Promise<ThesisForTarget[]> {
  return q<ThesisForTarget>(
    `select t.id, t.statement,
            (select r.id from thesis_reports r
              where r.thesis_id = t.id order by r.generated_at desc, r.id limit 1) as latest_report_id
       from theses t
      where t.status = 'active' and t.claim_codes @> array[$1]::text[]
      order by t.statement, t.id`,
    [code]
  );
}

// The /map thesis desk (admin): every ACTIVE thesis, whether or not it has a
// saved report, with its latest run's stats and the flagged gap count. Guests
// keep the report-anchored tracker (getLatestThesisReports); this shape exists
// so a freshly drafted thesis is visible on /map the moment it is created.
export interface ThesisDeskEntry {
  id: string;
  statement: string;
  claim_count: number;
  gap_count: number;
  report_count: number;
  last_generated_at: string | null;
  matched: number;
  supports: number;
  contradicts: number;
  mixed: number;
}

export async function getThesisDesk(): Promise<ThesisDeskEntry[]> {
  return q<ThesisDeskEntry>(
    `select t.id, t.statement,
            coalesce(array_length(t.claim_codes, 1), 0) as claim_count,
            coalesce(jsonb_array_length(t.gap_scan->'recommendations'), 0) as gap_count,
            (select count(*) from thesis_reports x where x.thesis_id = t.id)::int as report_count,
            r.generated_at::text as last_generated_at,
            coalesce((r.pack->'stats'->>'matched')::int, 0) as matched,
            coalesce((r.pack->'stats'->'stances'->>'supports')::int, 0) as supports,
            coalesce((r.pack->'stats'->'stances'->>'contradicts')::int, 0) as contradicts,
            coalesce((r.pack->'stats'->'stances'->>'mixed')::int, 0) as mixed
       from theses t
       left join lateral (
         select generated_at, pack from thesis_reports
          where thesis_id = t.id
          order by generated_at desc, id limit 1
       ) r on true
      where t.status = 'active'
      order by t.updated_at desc, t.id`
  );
}

// The logic-tree data for a thesis's mapped codes: each resolved claim/bridge with
// its confidence band and, for claims, the questions it bears on (via stance
// edges). ADMIN-ONLY caller today (/theses/[id]); confidence_label must be
// stripped before this ever feeds a public surface.
export interface ThesisTreeNode {
  code: string;
  kind: 'claim' | 'bridge';
  statement: string;
  confidence_label: ConfidenceLabel | null;
  href: string;
  questions: { slug: string; label: string; title: string }[];  // claims only
  domain_from: string | null;                                   // bridges only
  domain_to: string | null;
}

export async function getThesisTreeData(claimCodes: string[]): Promise<ThesisTreeNode[]> {
  if (!claimCodes.length) return [];
  const [claimRows, bridgeRows] = await Promise.all([
    q<{ code: string; statement: string; confidence_label: ConfidenceLabel; slug: string | null; sort_order: number | null; title: string | null }>(
      `select c.code, c.statement, c.confidence_label,
              qn.slug, qn.sort_order, qn.title
         from claims c
         left join edges e on e.from_type = 'claim' and e.from_id = c.id and e.to_type = 'stance'
         left join stances s on s.id = e.to_id
         left join questions qn on qn.id = s.question_id
        where c.code = any($1::text[]) and c.is_frame = false
        order by c.code, qn.sort_order`,
      [claimCodes]
    ),
    q<{ code: string; statement: string; confidence_label: ConfidenceLabel; domain_from: string; domain_to: string }>(
      `select code, statement, confidence_label, domain_from::text as domain_from, domain_to::text as domain_to
         from bridge_claims where code = any($1::text[]) order by code`,
      [claimCodes]
    ),
  ]);

  const byCode = new Map<string, ThesisTreeNode>();
  for (const r of claimRows) {
    let node = byCode.get(r.code);
    if (!node) {
      node = {
        code: r.code, kind: 'claim', statement: r.statement, confidence_label: r.confidence_label,
        href: `/claim/${encodeURIComponent(r.code)}`, questions: [], domain_from: null, domain_to: null,
      };
      byCode.set(r.code, node);
    }
    if (r.slug && !node.questions.some((x) => x.slug === r.slug)) {
      node.questions.push({ slug: r.slug, label: `Q${r.sort_order}`, title: r.title ?? '' });
    }
  }
  for (const r of bridgeRows) {
    if (!byCode.has(r.code)) {
      byCode.set(r.code, {
        code: r.code, kind: 'bridge', statement: r.statement, confidence_label: r.confidence_label,
        href: `/bridge/${encodeURIComponent(r.code)}`, questions: [],
        domain_from: r.domain_from, domain_to: r.domain_to,
      });
    }
  }
  // Preserve the thesis's mapping order; unresolved codes are simply absent.
  return claimCodes.flatMap((c) => byCode.get(c) ?? []);
}

// The thesis's latest saved run — the delta baseline for the next pack build.
export async function getLatestThesisRun(
  thesisId: string
): Promise<{ id: string; generated_at: string; signal_ids: string[] } | null> {
  return one<{ id: string; generated_at: string; signal_ids: string[] }>(
    `select id, generated_at::text as generated_at, signal_ids
       from thesis_reports
      where thesis_id = $1
      order by generated_at desc, id
      limit 1`,
    [thesisId]
  );
}

// ---- Nav queue badges -------------------------------------------------------
// One cheap round trip for the admin nav's live counts: work waiting in an
// in-flight pipeline run, active signal drafts, and the paper review queue.
// Called by Header ONLY for admins, so guests never pay for it.
export async function getNavCounts(): Promise<{ pipeline: number; drafts: number; papers: number; scout: number; tickets: number }> {
  const row = await one<{ pipeline: number; drafts: number; papers: number; scout: number; tickets: number }>(
    `select
       (select count(*) from signal_candidates sc
          join pipeline_runs r on r.id = sc.run_id
         where r.status = 'running' and sc.triage_status = 'pending')::int as pipeline,
       (select count(*) from signals
         where is_published = false and archived_at is null)::int as drafts,
       (select count(*) from papers
         where triage_status = 'kept' and review_status = 'pending')::int as papers,
       (select count(*) from companies where status = 'queued')::int as scout,
       (select count(*) from tickets where status = 'open')::int as tickets`
  );
  return row ?? { pipeline: 0, drafts: 0, papers: 0, scout: 0, tickets: 0 };
}

// ---- Tickets — the public feedback box (migration 0032) ---------------------
// Admin-only readers: `email`, `admin_note`, and `user_agent` never leave an
// admin surface. Images are served by the admin-gated /api/tickets/image route.

export async function getTickets(filter: { kind?: TicketKind; status?: TicketStatus } = {}): Promise<Ticket[]> {
  return q<Ticket>(
    `select t.id, t.kind::text as kind, t.status::text as status, t.title, t.body, t.email,
            t.severity, t.page, t.user_agent, t.admin_note,
            t.resolved_at::text as resolved_at, t.created_at::text as created_at, t.updated_at::text as updated_at,
            coalesce(
              (select array_agg(i.id order by i.created_at) from ticket_images i where i.ticket_id = t.id),
              '{}'
            ) as image_ids
       from tickets t
      where ($1::ticket_kind_t is null or t.kind = $1::ticket_kind_t)
        and ($2::ticket_status_t is null or t.status = $2::ticket_status_t)
      order by (t.status in ('open', 'in_progress')) desc, t.created_at desc
      limit 200`,
    [filter.kind ?? null, filter.status ?? null]
  );
}

export async function getTicketImage(id: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  return one<{ content_type: string; bytes: Buffer }>(
    `select content_type, bytes from ticket_images where id = $1`,
    [id]
  );
}

// One cheap round trip for the lobby's live tile stats. Counts only, guest-safe
// by construction (nothing here touches the personal layer).
interface LobbyStats {
  claims: number;
  signalsPublished: number;
  signalsWeek: number;
  theses: number;
  papersTracked: number;
  threads: number;
}

export async function getLobbyStats(): Promise<LobbyStats> {
  const row = await one<LobbyStats>(
    `select
       (select count(*) from claims where is_frame = false)::int as "claims",
       (select count(*) from signals where is_published)::int as "signalsPublished",
       (select count(*) from signals
         where is_published and published_at >= now() - interval '7 days')::int as "signalsWeek",
       (select count(*) from theses)::int as "theses",
       (select count(*) from papers where review_status = 'tracked')::int as "papersTracked",
       (select count(*) from research_threads)::int as "threads"`
  );
  return row ?? { claims: 0, signalsPublished: 0, signalsWeek: 0, theses: 0, papersTracked: 0, threads: 0 };
}

// The front page's thesis tracker: the latest saved run per standing thesis,
// newest first. Everything here is guest-safe by construction (the pack's stats
// are the public shareable report's own numbers).
export interface ThesisTrackerEntry {
  report_id: string;
  thesis_id: string;
  title: string;
  statement: string;
  generated_at: string;
  matched: number;
  supports: number;
  contradicts: number;
  mixed: number;
}

export async function getLatestThesisReports(limit = 2): Promise<ThesisTrackerEntry[]> {
  return q<ThesisTrackerEntry>(
    `select id as report_id, thesis_id, title, statement,
            generated_at::text as generated_at,
            coalesce((pack->'stats'->>'matched')::int, 0) as matched,
            coalesce((pack->'stats'->'stances'->>'supports')::int, 0) as supports,
            coalesce((pack->'stats'->'stances'->>'contradicts')::int, 0) as contradicts,
            coalesce((pack->'stats'->'stances'->>'mixed')::int, 0) as mixed
       from (
         select distinct on (thesis_id) *
           from thesis_reports
          order by thesis_id, generated_at desc
       ) t
      order by generated_at desc, id
      limit $1`,
    [limit]
  );
}

// ---- Generated reports (the Report Portal's tear sheets, migration 0030) ----

const GEN_REPORT_META = `
  id, kind::text as kind, subject, title,
  to_char(scope_from, 'YYYY-MM-DD') as scope_from,
  to_char(scope_to, 'YYYY-MM-DD') as scope_to,
  is_published, generated_at::text as generated_at`;

// Strip stored narrative HTML to a plain-text excerpt (word-boundary clamp).
// Text-only by construction: the preview can never carry a link, so it needs no
// citation-gate pass (the full read view re-gates as always).
function textExcerpt(html: string | null | undefined, max: number): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0*39;|&#x0*27;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&#0*34;|&#x0*22;|&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 40))}…`;
}

export async function listGeneratedReports(publishedOnly: boolean): Promise<GeneratedReportMeta[]> {
  // The row-expansion preview projects only the small parts of the stored jsonb:
  // the bottom line (stripped to plain text below, so it carries no links and
  // needs no citation-gate pass) and the pack's deterministic stats/health.
  const rows = await q<GeneratedReportMeta & { bottom_line: string | null }>(
    `select ${GEN_REPORT_META},
            narrative->>'bottomLine' as bottom_line,
            pack->'stats' as stats,
            pack->'health' as health
       from generated_reports
       ${publishedOnly ? 'where is_published = true' : ''}
      order by generated_at desc, id`
  );
  return rows.map(({ bottom_line, ...r }) => ({
    ...r,
    // Some narratives open with a literal "Bottom line:" prefix; the row's
    // preview label already says it, so strip the doubled words.
    abstract: textExcerpt(bottom_line, 460).replace(/^bottom line[:.]?\s*/i, '') || null,
  }));
}

export async function getGeneratedReport(id: string): Promise<SavedSheet | null> {
  return one<SavedSheet>(
    `select ${GEN_REPORT_META}, pack, narrative from generated_reports where id = $1`,
    [id]
  );
}

// ---- Retained-text coverage (the full-text hydration guard, /pipeline) ----
// A published signal "has text" when its source row carries raw_text or any of
// its candidate rows cached raw_content — the same coalesce the document viewer
// and the articles-full-text dataset read.

export interface TextCoverage {
  total: number;
  with_text: number;
}

export async function getTextCoverage(): Promise<TextCoverage> {
  const row = await one<TextCoverage>(
    `select count(*)::int as total,
            count(*) filter (where src.raw_text is not null and length(src.raw_text) > 0
              or exists (select 1 from signal_candidates c
                          where c.signal_id = s.id and c.raw_content is not null))::int as with_text
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published`
  );
  return row ?? { total: 0, with_text: 0 };
}

// A published signal missing retained text, with the URL a refetch would use
// (curated source URL first, else the newest candidate's) and the rows the
// fetched text could be stored on.
export interface MissingTextRow {
  signal_id: string;
  title: string;
  source_id: string | null;
  candidate_id: string | null;
  url: string | null;
}

const MISSING_TEXT_SQL = `
  select s.id::text as signal_id, s.title, src.id::text as source_id,
         sc.id::text as candidate_id, coalesce(src.url, sc.url) as url
    from signals s
    left join sources src on src.id = s.source_id
    left join lateral (
      select c.id, c.url from signal_candidates c
       where c.signal_id = s.id
       order by c.retrieved_at desc, c.id limit 1
    ) sc on true
   where s.is_published
     and (src.raw_text is null or length(src.raw_text) = 0)
     and not exists (select 1 from signal_candidates c
                      where c.signal_id = s.id and c.raw_content is not null)`;

export async function listSignalsMissingText(limit = 5): Promise<MissingTextRow[]> {
  return q<MissingTextRow>(
    `${MISSING_TEXT_SQL} order by s.published_at desc nulls last, s.id limit $1`,
    [limit]
  );
}

// The publish-time guard's lookup: the same shape for ONE signal, null when it
// already holds text (nothing to do).
export async function getSignalTextTarget(signalId: string): Promise<MissingTextRow | null> {
  return one<MissingTextRow>(`${MISSING_TEXT_SQL} and s.id = $1`, [signalId]);
}

// ---- Queue agent (migration 0033) -------------------------------------------
// Readers for the research console's recommend-only queue agent.

// The run button processes ALL pending papers each time (already-recommended
// rows are refreshed too), so editing the steering note and re-running never
// leaves stale recommendations behind. Idempotent; a full pass costs cents.
export async function getAllPendingPaperIds(limit = 400): Promise<{ id: string; title: string }[]> {
  return q<{ id: string; title: string }>(
    `select id, title from papers
      where triage_status = 'kept' and review_status = 'pending'
      order by published_at desc nulls last
      limit $1`,
    [limit]
  );
}

// Counts per agent recommendation over the pending queue, for the panel's
// summary strip and bulk buttons ('none' = not yet processed).
export async function getAgentQueueSummary(): Promise<Record<string, number>> {
  const rows = await q<{ rec: string; n: number }>(
    `select coalesce(agent_recommendation::text, 'none') as rec, count(*)::int as n
       from papers
      where triage_status = 'kept' and review_status = 'pending'
      group by 1`
  );
  const out: Record<string, number> = { tracked: 0, noted: 0, dismissed: 0, none: 0 };
  for (const r of rows) out[r.rec] = r.n;
  return out;
}

export async function getSteeringNote(): Promise<string | null> {
  const row = await one<{ steering: string | null }>(`select steering from research_agent_prefs where id = true`);
  return row?.steering ?? null;
}

// The admin's revealed preferences, digested for the agent prompt: what got
// tracked (with the human why), noted, and dismissed. Taste without training.
export async function getReviewTasteDigest(): Promise<{
  tracked: { title: string; note: string | null }[];
  noted: string[];
  dismissed: string[];
}> {
  const [tracked, noted, dismissed] = await Promise.all([
    q<{ title: string; note: string | null }>(
      `select title, review_note as note from papers
        where review_status = 'tracked' order by reviewed_at desc nulls last limit 25`
    ),
    q<{ title: string }>(
      `select title from papers where review_status = 'noted'
        order by reviewed_at desc nulls last limit 15`
    ),
    q<{ title: string }>(
      `select title from papers where review_status = 'dismissed'
        order by reviewed_at desc nulls last limit 25`
    ),
  ]);
  return { tracked, noted: noted.map((r) => r.title), dismissed: dismissed.map((r) => r.title) };
}

// ---- Startup Scout (migration 0034) -----------------------------------------
// The acquisition-target funnel. Leak discipline (the research-portal pattern):
// the agent layer (verdict/scores/reason), review notes, provenance, and any
// non-tracked company are admin-only, and the guest getters simply never SELECT
// those columns, so nothing private reaches the RSC payload. A public "pursue"
// chip on a named startup would disclose M&A intent.

const COMPANY_PUBLIC_COLUMNS = `
  id, name, domain, url, vertical, one_liner, ai_tech, founded_year, stage,
  funding_note, hq, status, origin, created_at, updated_at`;
const COMPANY_ADMIN_COLUMNS = `${COMPANY_PUBLIC_COLUMNS},
  review_note, reviewed_at::text as reviewed_at,
  agent_verdict, agent_reason, agent_confidence, agent_scores, agent_at::text as agent_at,
  fetched_via, run_id, found_url`;

export async function getScoutVerticals(personal = false): Promise<ScoutVertical[]> {
  return q<ScoutVertical>(
    `select v.slug, v.name, v.description, v.search_queries, v.active,
            (select count(*)::int from companies c where c.vertical = v.slug and c.status = 'tracked') as tracked_count
            ${personal ? `, (select count(*)::int from companies c where c.vertical = v.slug and c.status = 'queued') as queued_count` : ''}
       from scout_verticals v
      order by v.name`
  );
}

// The public monitor: tracked companies only (the watchlist), newest decision first.
export async function getTrackedCompanies(personal = false): Promise<Company[]> {
  return q<Company>(
    `select ${personal ? COMPANY_ADMIN_COLUMNS : COMPANY_PUBLIC_COLUMNS}
       from companies where status = 'tracked'
      order by reviewed_at desc nulls last, created_at desc`
  );
}

// Three viewer tiers. Admin: everything, any status. Portal (team key): PUBLIC
// columns for tracked + queued companies (their adds land in the queue, so they
// must see them; the agent layer stays admin-only always). Guest: PUBLIC
// columns, tracked only; anything else resolves to null (404).
export async function getCompany(
  id: string,
  viewer: { admin: boolean; portal: boolean }
): Promise<Company | null> {
  if (viewer.admin) {
    return one<Company>(
      `select ${COMPANY_ADMIN_COLUMNS}, raw_content, dossier from companies where id = $1`,
      [id]
    );
  }
  return one<Company>(
    `select ${COMPANY_PUBLIC_COLUMNS} from companies
      where id = $1 and status = any($2::company_status_t[])`,
    [id, viewer.portal ? ['tracked', 'queued'] : ['tracked']]
  );
}

// The portal's "In the review queue" strip: PUBLIC columns only, so the agent
// layer never reaches a keyholder's payload.
export async function getQueuedCompaniesPublic(limit = 50): Promise<Company[]> {
  return q<Company>(
    `select ${COMPANY_PUBLIC_COLUMNS} from companies
      where status = 'queued' order by created_at desc, id limit $1`,
    [limit]
  );
}

export async function getCompanyEvents(companyId: string): Promise<CompanyEvent[]> {
  return q<CompanyEvent>(
    `select id, company_id, to_char(event_date, 'YYYY-MM-DD') as event_date,
            kind, title, url, note, signal_id, created_at
       from company_events where company_id = $1
      order by event_date desc, created_at desc`,
    [companyId]
  );
}

// The public monitor's recent-activity strip: events on tracked companies only.
export async function getRecentCompanyEvents(limit = 10): Promise<CompanyEventWithCompany[]> {
  return q<CompanyEventWithCompany>(
    `select e.id, e.company_id, to_char(e.event_date, 'YYYY-MM-DD') as event_date,
            e.kind, e.title, e.url, e.note, e.signal_id, e.created_at,
            c.name as company_name, c.status as company_status
       from company_events e
       join companies c on c.id = e.company_id
      where c.status = 'tracked'
      order by e.event_date desc, e.created_at desc
      limit $1`,
    [limit]
  );
}

// The review queue (admin): discovered companies awaiting the human decision.
export async function getScoutQueue(limit = 200): Promise<Company[]> {
  return q<Company>(
    `select ${COMPANY_ADMIN_COLUMNS} from companies
      where status = 'queued'
      order by created_at desc
      limit $1`,
    [limit]
  );
}

export async function getScoutRuns(limit = 12): Promise<ScoutRun[]> {
  return q<ScoutRun>(
    `select id, triggered_at, status, step, found_count, new_count, error, created_at, updated_at
       from scout_runs order by triggered_at desc limit $1`,
    [limit]
  );
}

export async function getScoutPrefs(): Promise<ScoutPrefs> {
  const row = await one<ScoutPrefs>(`select steering, rubric from scout_prefs where id = true`);
  return row ?? { steering: null, rubric: null };
}

// Retained company documents (migration 0035). List reads omit the text column
// (it can be 200k chars); the text getter serves re-extraction only.
export async function getCompanyDocuments(companyId: string): Promise<CompanyDocument[]> {
  return q<CompanyDocument>(
    `select id, company_id, filename, origin, char_count, doc_summary,
            to_char(created_at, 'YYYY-MM-DD') as created_at
       from company_documents where company_id = $1
      order by created_at desc, id`,
    [companyId]
  );
}

export async function getCompanyDocumentText(id: string): Promise<{ company_id: string; text: string } | null> {
  return one<{ company_id: string; text: string }>(
    `select company_id::text as company_id, text from company_documents where id = $1`,
    [id]
  );
}

// Every queued company id, for the agent panel's chunked processing loop.
// Re-runs deliberately include already-scored rows so fresh steering re-scores.
export async function getScoutQueueIds(limit = 400): Promise<{ id: string; name: string }[]> {
  return q(`select id::text as id, name from companies where status = 'queued' order by created_at limit $1`, [limit]);
}

export async function getScoutAgentSummary(): Promise<Record<string, number>> {
  const rows = await q<{ verdict: string | null; n: string }>(
    `select agent_verdict::text as verdict, count(*)::text as n
       from companies where status = 'queued' group by agent_verdict`
  );
  const out: Record<string, number> = { pursue: 0, watch: 0, pass: 0, none: 0 };
  for (const r of rows) out[r.verdict ?? 'none'] = Number(r.n);
  return out;
}

// The admin's revealed preferences on companies, digested for the agent prompt.
export async function getScoutTasteDigest(): Promise<{
  tracked: { name: string; note: string | null }[];
  dismissed: string[];
}> {
  const [tracked, dismissed] = await Promise.all([
    q<{ name: string; note: string | null }>(
      `select name, review_note as note from companies
        where status = 'tracked' order by reviewed_at desc nulls last limit 25`
    ),
    q<{ name: string }>(
      `select name from companies where status = 'dismissed'
        order by reviewed_at desc nulls last limit 25`
    ),
  ]);
  return { tracked, dismissed: dismissed.map((r) => r.name) };
}

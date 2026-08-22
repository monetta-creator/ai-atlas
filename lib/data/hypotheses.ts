import { q, one } from '../db';
import { strip, countEvidence, getEvidenceFor, getRationales } from './shared';
import type {
  CalibrationData, CalibrationMove, CalibrationSnapshot, CalibrationTrajectory,
  Evidence, Hypothesis, HypothesisLink, HypothesisReportMeta, HypothesisStatus,
  Rationale, SavedHypothesisReport, Signal, Source,
} from '../types';

// Hypothesis reads. `personal` gates the conviction layer: strip() nulls it for
// guests before anything leaves the server.

const HYPOTHESIS_COLUMNS = `
  id, code, statement, test, note, resolvability, conviction, conviction_label,
  status, created_at, updated_at`;

export async function getHypotheses(
  personal: boolean,
  opts: { status?: HypothesisStatus | 'all' } = {}
): Promise<Hypothesis[]> {
  const status = opts.status ?? 'active';
  const rows = await q<Hypothesis>(
    `select ${HYPOTHESIS_COLUMNS},
            (select count(*)::int from evidence e where e.hypothesis_id = h.id) as evidence_count,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id and e.direction = 'supports') as supports,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id and e.direction = 'contradicts') as contradicts,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id and e.direction = 'neutral') as neutral,
            (select count(distinct e.signal_id)::int from evidence e where e.hypothesis_id = h.id and e.signal_id is not null) as signal_count,
            (select r.created_at::text from rationales r where r.hypothesis_id = h.id order by r.created_at desc limit 1) as last_moved,
            (select count(*)::int from hypothesis_reports hr where hr.hypothesis_id = h.id) as report_count,
            (select hr.generated_at::text from hypothesis_reports hr where hr.hypothesis_id = h.id order by hr.generated_at desc limit 1) as last_generated_at
       from hypotheses h
      ${status === 'all' ? '' : `where status = '${status === 'active' ? 'active' : status}'`}
      order by substring(code from 2)::int nulls last, code`,
    []
  );
  return rows.map((r) => strip(r, personal));
}

export interface HypothesisView {
  hypothesis: Hypothesis;
  evidence: Evidence[];
  counts: ReturnType<typeof countEvidence>;
  rationales: Rationale[];          // [] for guests
  links: HypothesisLink[];
  signals: Signal[];                // published signals touching this code
  reports: HypothesisReportMeta[];
}

export async function getHypothesis(code: string, personal: boolean): Promise<HypothesisView | null> {
  const h = await one<Hypothesis>(
    `select ${HYPOTHESIS_COLUMNS}, gap_scan from hypotheses where code = $1`,
    [code]
  );
  if (!h) return null;
  const [evidence, rationales, links, signals, reports] = await Promise.all([
    getEvidenceFor(h.id, personal),
    personal ? getRationales(h.id) : Promise.resolve([]),
    getHypothesisLinks(h.id),
    getSignalsTouching(code),
    getHypothesisReportsMeta(h.id),
  ]);
  const view: HypothesisView = {
    hypothesis: strip(h, personal),
    evidence,
    counts: countEvidence(evidence),
    rationales,
    links,
    signals,
    reports,
  };
  if (!personal) {
    // gap_scan is a working-layer artifact; never ship it to guests.
    delete (view.hypothesis as { gap_scan?: unknown }).gap_scan;
  }
  return view;
}

export async function getHypothesisById(id: string): Promise<Hypothesis | null> {
  return one<Hypothesis>(`select ${HYPOTHESIS_COLUMNS}, gap_scan from hypotheses where id = $1`, [id]);
}

async function getHypothesisLinks(id: string): Promise<HypothesisLink[]> {
  // Links from either end, with the FAR end's code/statement joined for display.
  return q<HypothesisLink>(
    `select l.id, l.from_id, l.to_id, l.note, h.code, h.statement
       from hypothesis_links l
       join hypotheses h on h.id = (case when l.from_id = $1 then l.to_id else l.from_id end)
      where l.from_id = $1 or l.to_id = $1
      order by h.code`,
    [id]
  );
}

async function getSignalsTouching(code: string): Promise<Signal[]> {
  return q<Signal>(
    `select id, title, summary, significance, context, touches,
            source_id, published_at::text as published_at, is_published, archived_at::text as archived_at,
            origin, created_at::text as created_at, updated_at::text as updated_at
       from signals
      where is_published and touches @> array[$1]::text[]
      order by published_at desc
      limit 30`,
    [code]
  );
}

// The full code list for validators and AI prompts (touch validation, retrieval
// namespaces). Small by design.
export interface TargetOption {
  id: string;
  code: string;
  statement: string;
  test: string | null;
}
export async function getTargets(): Promise<{ hypotheses: TargetOption[] }> {
  const hypotheses = await q<TargetOption>(
    `select id, code, statement, test from hypotheses
      where status = 'active'
      order by substring(code from 2)::int nulls last, code`
  );
  return { hypotheses };
}

export async function getTestsByCodes(codes: string[]): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const rows = await q<{ code: string; test: string }>(
    `select code, test from hypotheses where code = any($1::text[])`,
    [codes]
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.test]));
}

// ---- sources ----------------------------------------------------------------

export async function getSourceMeta(
  id: string
): Promise<{ outlet: string | null; author: string | null } | null> {
  return one(`select outlet, author from sources where id = $1`, [id]);
}

export async function getSources(): Promise<Source[]> {
  return q<Source>(
    `select id, title, author, outlet, url, published_at::text as published_at,
            reliability_prior, dossier, created_at::text as created_at
       from sources order by created_at desc`
  );
}

export interface SourceEvidenceRow {
  id: string;
  hypothesis_id: string;
  code: string;
  statement: string;
  direction: Evidence['direction'];
  confidence: Evidence['confidence'];
  excerpt: string | null;
  note: string | null;
}

export async function getSource(id: string): Promise<{
  source: Source & { raw_text: string | null };
  evidence: SourceEvidenceRow[];
} | null> {
  const source = await one<Source & { raw_text: string | null }>(
    `select id, title, author, outlet, url, published_at::text as published_at,
            reliability_prior, dossier, raw_text, created_at::text as created_at
       from sources where id = $1`,
    [id]
  );
  if (!source) return null;
  const evidence = await q<SourceEvidenceRow>(
    `select ev.id, ev.hypothesis_id, h.code, h.statement, ev.direction, ev.confidence, ev.excerpt, ev.note
       from evidence ev
       join hypotheses h on h.id = ev.hypothesis_id
      where ev.source_id = $1
      order by ev.created_at desc`,
    [id]
  );
  return { source, evidence };
}

export interface SourceWithCounts extends Source {
  evidence_count: number;
  hypothesis_count: number;
  raw_text_len: number;
}

export async function getSourcesWithCounts(): Promise<SourceWithCounts[]> {
  return q<SourceWithCounts>(
    `select s.id, s.title, s.author, s.outlet, s.url, s.published_at::text as published_at,
            s.reliability_prior, s.dossier, s.created_at::text as created_at,
            coalesce(length(s.raw_text), 0) as raw_text_len,
            (select count(*)::int from evidence e where e.source_id = s.id) as evidence_count,
            (select count(distinct e.hypothesis_id)::int from evidence e where e.source_id = s.id) as hypothesis_count
       from sources s
      order by s.created_at desc`
  );
}

export async function getAsOf(): Promise<string | null> {
  const row = await one<{ at: string | null }>(
    `select greatest(
       (select max(updated_at) from hypotheses),
       (select max(updated_at) from evidence),
       (select max(updated_at) from signals)
     )::text as at`
  );
  return row?.at ?? null;
}

// ---- calibration (the conviction history; admin-only surface) ---------------

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export async function getCalibration(): Promise<CalibrationData> {
  const snaps = await q<{ id: string; taken_at: string; trigger: string; state: { hypotheses?: Record<string, number | null> } }>(
    `select id, taken_at::text as taken_at, trigger, state from snapshots order by taken_at asc`
  );
  const hyps = await q<{ id: string; code: string; statement: string; conviction: number | null }>(
    `select id, code, statement, conviction from hypotheses`
  );
  const byId = new Map(hyps.map((h) => [h.id, h]));

  const band = (c: number) => (c < 0.4 ? 'thin' : c < 0.6 ? 'contested' : c < 0.8 ? 'leaning' : 'settled');

  const snapshots: CalibrationSnapshot[] = snaps.map((s) => {
    const values = Object.values(s.state?.hypotheses ?? {}).filter((v): v is number => typeof v === 'number');
    const bands = { thin: 0, contested: 0, leaning: 0, settled: 0 };
    for (const v of values) bands[band(v) as keyof typeof bands]++;
    return { at: fmtDate(s.taken_at), trigger: s.trigger, bands, total: values.length };
  });

  const trajectories: CalibrationTrajectory[] = [];
  for (const [id, h] of byId) {
    const points: { at: string; conviction: number }[] = [];
    for (const s of snaps) {
      const v = s.state?.hypotheses?.[id];
      if (typeof v === 'number') points.push({ at: fmtDate(s.taken_at), conviction: v });
    }
    if (!points.length) continue;
    let moves = 0;
    for (let i = 1; i < points.length; i++) if (points[i].conviction !== points[i - 1].conviction) moves++;
    trajectories.push({
      id,
      code: h.code,
      label: h.statement,
      href: `/hypothesis/${h.code}`,
      points,
      first: points[0].conviction,
      current: typeof h.conviction === 'number' ? h.conviction : points[points.length - 1].conviction,
      moves,
    });
  }
  trajectories.sort((a, b) => b.moves - a.moves || a.code.localeCompare(b.code));

  const moveRows = await q<{
    id: string; created_at: string; hypothesis_id: string;
    old_conviction: number | null; new_conviction: number | null; reason: string;
    evidence_excerpt: string | null; evidence_direction: Evidence['direction'] | null; evidence_source: string | null;
  }>(
    `select r.id, r.created_at::text as created_at, r.hypothesis_id,
            r.old_conviction, r.new_conviction, r.reason,
            ev.excerpt as evidence_excerpt, ev.direction as evidence_direction,
            coalesce(s.title, sig.title) as evidence_source
       from rationales r
       left join evidence ev on ev.id = r.evidence_id
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      order by r.created_at desc`
  );
  const moves: CalibrationMove[] = moveRows.map((m) => {
    const h = byId.get(m.hypothesis_id);
    return {
      id: m.id,
      at: fmtDate(m.created_at),
      code: h?.code ?? null,
      label: h?.statement ?? '(deleted hypothesis)',
      href: h ? `/hypothesis/${h.code}` : null,
      old_conviction: m.old_conviction,
      new_conviction: m.new_conviction,
      reason: m.reason,
      evidence_excerpt: m.evidence_excerpt,
      evidence_direction: m.evidence_direction,
      evidence_source: m.evidence_source,
    };
  });

  return {
    snapshots,
    trajectories,
    moves,
    totals: {
      snapshots: snaps.length,
      moves: moves.length,
      nodesMoved: trajectories.filter((t) => t.moves > 0).length,
      firstAt: snaps.length ? fmtDate(snaps[0].taken_at) : null,
      lastAt: snaps.length ? fmtDate(snaps[snaps.length - 1].taken_at) : null,
    },
  };
}

// ---- hypothesis reports (the frozen runs) ------------------------------------

export async function getHypothesisReportsMeta(hypothesisId: string): Promise<HypothesisReportMeta[]> {
  return q<HypothesisReportMeta>(
    `select id, hypothesis_id, title, generated_at::text as generated_at,
            coalesce((pack->'stats'->>'matched')::int, 0) as matched
       from hypothesis_reports
      where hypothesis_id = $1
      order by generated_at desc`,
    [hypothesisId]
  );
}

export async function getHypothesisReport(id: string): Promise<SavedHypothesisReport | null> {
  return one<SavedHypothesisReport>(
    `select id, hypothesis_id, title, statement, pack, narrative, generated_at::text as generated_at
       from hypothesis_reports where id = $1`,
    [id]
  );
}

// The delta baseline for a new run: the hypothesis's latest saved report.
export async function getLatestHypothesisRun(
  hypothesisId: string
): Promise<{ id: string; generated_at: string; signal_ids: string[] } | null> {
  return one(
    `select id, generated_at::text as generated_at, signal_ids
       from hypothesis_reports
      where hypothesis_id = $1
      order by generated_at desc limit 1`,
    [hypothesisId]
  );
}

// The latest public report per hypothesis (guest link targets).
export async function getLatestReportIds(): Promise<Record<string, string>> {
  const rows = await q<{ hypothesis_id: string; id: string }>(
    `select distinct on (hypothesis_id) hypothesis_id, id
       from hypothesis_reports
      order by hypothesis_id, generated_at desc`
  );
  return Object.fromEntries(rows.map((r) => [r.hypothesis_id, r.id]));
}

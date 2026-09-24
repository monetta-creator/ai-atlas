import type {
  Direction, EvidenceType, Significance, SignalLens, SignalOrigin,
  ThesisDelta, ThesisPack, ThesisPackClaim, ThesisPackEvidence, ThesisPackSignal, ThesisStats,
} from '../types';

// Evidence-type groupings for the by-type tally (migration 0065): types that
// carry an OBSERVED outcome vs. types that are merely asserted. Kept as the
// one source of truth so pack-core and the narrative prompt never drift.
export const MEASURED_EVIDENCE_TYPES: EvidenceType[] = ['experiment', 'statistics', 'survey'];
export const ASSERTED_EVIDENCE_TYPES: EvidenceType[] = ['projection', 'announcement', 'analysis', 'other'];

// The deterministic core of a thesis report: retrieval + stats, zero AI, zero
// randomness. Given the same corpus and the same thesis, this produces the same
// pack byte-for-byte (generated_at aside) — every ORDER BY carries a stable id
// tiebreaker, tags are assigned in that order, and all stats are computed in code.
//
// Query access is INJECTED (`Q`) rather than imported from lib/db so the
// determinism test (scripts/test-thesis.mjs) can drive the exact production SQL
// from plain Node. Only type-only imports plus other pure modules (extensioned,
// for Node's type-stripping test loader) may be imported here.
//
// GUEST-SAFE BY CONSTRUCTION: a saved report is publicly shareable, so nothing in
// the personal layer may enter the pack. The queries below never select
// confidence, confidence_label, rationales, evidence.note, or reliability_prior.
// (evidence.excerpt and touch directions are public on claim pages already.)

import { domainOfUrl, quarterBuckets, quarterShare, ORQ } from '../pack-shared.ts';
import type { Q } from '../pack-shared.ts';

export interface ThesisInput {
  id: string;
  statement: string;
  claim_codes: string[];
}

export interface PrevRun {
  id: string;
  generated_at: string;   // ISO
  signal_ids: string[];
}

// ORQ (the OR-combined tsquery shared with the ask retrieval legs) now comes
// from pack-shared, so all three FTS surfaces stay in sync.

const TEXT_LIMIT = 60;   // text-match cap; claim-matched signals are never capped

const SIG_COLS = `
  s.id, s.title, s.summary, s.significance::text as significance,
  s.lenses::text[] as lenses, s.claim_touches, s.evidence_type,
  to_char(s.published_at, 'YYYY-MM-DD') as published_at,
  s.origin::text as origin,
  src.title as source_title, src.url as source_url`;

interface SigRow {
  id: string;
  title: string;
  summary: string | null;
  significance: Significance;
  lenses: SignalLens[];
  claim_touches: string[];
  evidence_type: EvidenceType | null;
  published_at: string | null;
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
  rank?: number;
}

interface EvRow {
  code: string;
  direction: Direction;
  excerpt: string | null;
  signal_id: string | null;
}

// ---- Thesis-level relevance pass -------------------------------------------
// A signal can match a thesis through a mapped claim, but the claim is often
// broader than the thesis wording (the reviewer's call-center-headcount case:
// 110 of 141 matches were general AI news flow via a broad claim). This pass
// re-judges each matched signal against the THESIS STATEMENT itself, not the
// claim, and splits the pack below THESIS_RELEVANCE_MIN into `peripheral`.
//
// The real caller (lib/thesis/relevance.ts, routedStructured, chunks of 25) is
// INJECTED as `opts.scoreRelevance` rather than imported here, the same seam
// as the injected `Q`: it keeps this module network-free so
// scripts/test-thesis.mjs can drive it from plain Node with a stub scorer.
export const THESIS_RELEVANCE_MIN = 0.5;

export interface RelevancePromptSignal {
  signal_id: string;
  title: string;
  summary: string | null;
}

export interface RelevanceScore {
  signal_id: string;
  relevance: number;   // 0..1
  why: string;
}

export type RelevanceScorer = (
  thesisStatement: string,
  signals: RelevancePromptSignal[]
) => Promise<RelevanceScore[]>;

const RELEVANCE_SYSTEM =
  `You judge relevance for a thesis report in The AI Atlas. You receive a THESIS ` +
  `STATEMENT and a batch of Atlas signals that already matched it through its mapped ` +
  `claim or a text search, but a claim can be broader than the thesis wording itself, ` +
  `so a matched signal is not automatically on topic. Score each signal for how ` +
  `DIRECTLY it bears on the thesis as written, not on the general subject of the claim ` +
  `it happens to touch. A signal about a different mechanism, population, geography, ` +
  `or timeframe than the thesis describes should score low even when it touches the ` +
  `same claim. For every signal, return its exact signal_id, a relevance score, and a ` +
  `short reason. Never use an em dash; use a comma or a colon instead.`;

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)} ...` : t;
}

// Pure prompt builder: exported so both the real caller and the test suite can
// exercise the exact request shape without a network call.
export function relevancePrompt(
  thesisStatement: string,
  signals: RelevancePromptSignal[]
): { system: string; user: string; schema: object } {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            signal_id: { type: 'string', description: 'copy the id exactly as given' },
            relevance: {
              type: 'number',
              description: '0.0 (not directly about this thesis) to 1.0 (squarely about this thesis)',
            },
            why: { type: 'string', description: 'one short reason, at most 120 characters' },
          },
          required: ['signal_id', 'relevance', 'why'],
        },
      },
    },
    required: ['scores'],
  };
  const user = [
    `THESIS STATEMENT: ${thesisStatement}`,
    '',
    'SIGNALS TO SCORE (score every one):',
    ...signals.map((s) => `- id ${s.signal_id}: ${s.title}${s.summary ? `. ${clip(s.summary, 200)}` : ''}`),
  ].join('\n');
  return { system: RELEVANCE_SYSTEM, user, schema };
}

// Signal-level rollup of its per-mapped-claim directions.
export function stanceOf(directions: Record<string, Direction>): ThesisPackSignal['stance'] {
  const vals = Object.values(directions);
  if (!vals.length) return 'untyped';
  const sup = vals.includes('supports');
  const con = vals.includes('contradicts');
  if (sup && con) return 'mixed';
  if (sup) return 'supports';
  if (con) return 'contradicts';
  return 'neutral';
}

// The deterministic coverage statement. Plain sentences built from the numbers
// (never an em dash: rendered UI copy).
function corpusNoteFor(
  s: Omit<ThesisStats, 'corpusNote'>,
  hasCodes: boolean,
  relevanceApplied: boolean
): string {
  const parts: string[] = [];
  parts.push(
    `${s.matched} of ${s.scanned} published signals in the Atlas matched this thesis ` +
    `(${s.byMatch.claim + s.byMatch.both} via mapped claims, ${s.byMatch.text} via text match only).`
  );
  if (relevanceApplied) {
    parts.push(
      `${s.matched} of ${s.matched + s.peripheral} matched signals bear directly on the thesis; ` +
      `${s.peripheral} touch the mapped claims but not the thesis itself.`
    );
  }
  if (!hasCodes) {
    parts.push(
      'This thesis is not yet mapped to any Atlas claim, so no direction data is available; matches are text-based only.'
    );
  } else {
    const typed = s.matched - s.stances.untyped;
    parts.push(
      `Direction data covers ${typed} of ${s.matched} matched signals: ` +
      `${s.stances.supports} supporting, ${s.stances.contradicts} contradicting, ` +
      `${s.stances.mixed} mixed, ${s.stances.neutral} neutral.`
    );
  }
  const measuredCount = MEASURED_EVIDENCE_TYPES.reduce((sum, t) => sum + s.byType[t].total, 0);
  parts.push(
    `Of the ${s.matched} relevant signals, ${measuredCount} carry measured evidence ` +
    `(experiments, primary statistics, surveys): ${s.measured.supports} support, ` +
    `${s.measured.contradicts} contradict; the rest are announcements, projections, or commentary.`
  );
  if (s.oneSided) {
    parts.push(
      'Warning: the matched evidence is one-sided. No contradicting signal is in the corpus, which may reflect coverage, not reality.'
    );
  }
  if (s.thin) {
    parts.push('Coverage is thin. Treat this report as orientation on limited evidence, not a verdict.');
  }
  if (s.firstPublished && s.lastPublished) {
    parts.push(`Matched signals span ${s.firstPublished} to ${s.lastPublished}.`);
  }
  return parts.join(' ');
}

export function computeDelta(
  signals: ThesisPackSignal[],
  prev: PrevRun | null
): ThesisDelta | null {
  if (!prev) return null;
  const prevIds = new Set(prev.signal_ids);
  const currentIds = new Set(signals.map((s) => s.id));
  const fresh = signals.filter((s) => !prevIds.has(s.id));
  const stances = { supports: 0, contradicts: 0, mixed: 0, neutral: 0, untyped: 0 };
  for (const s of fresh) stances[s.stance]++;
  return {
    prev_report_id: prev.id,
    prev_generated_at: prev.generated_at,
    new_signal_tags: fresh.map((s) => s.tag),
    removed_count: prev.signal_ids.filter((id) => !currentIds.has(id)).length,
    new_stances: stances,
  };
}

export async function buildThesisPackCore(
  q: Q,
  thesis: ThesisInput,
  prev: PrevRun | null,
  opts: { textLimit?: number; scoreRelevance?: RelevanceScorer } = {}
): Promise<ThesisPack> {
  const codes = [...new Set(thesis.claim_codes)];
  const statement = thesis.statement.trim();
  const textLimit = opts.textLimit ?? TEXT_LIMIT;

  // 1) Corpus size + the two retrieval passes + mapped-claim resolution + the
  //    corpus's own published dates (for quarterShare below), all deterministic
  //    SQL (stable tiebreakers everywhere).
  const [scannedRow, claimMatched, textMatched, claimRows, corpusDateRows] = await Promise.all([
    q<{ n: number }>(`select count(*)::int as n from signals where is_published = true`),
    codes.length
      ? q<SigRow>(
          `select ${SIG_COLS}
             from signals s left join sources src on src.id = s.source_id
            where s.is_published = true and s.claim_touches && $1::text[]
            order by s.published_at desc nulls last, s.id`,
          [codes]
        )
      : Promise.resolve([] as SigRow[]),
    statement
      ? q<SigRow>(
          `select ${SIG_COLS}, ts_rank(s.search_tsv, ${ORQ})::float8 as rank
             from signals s left join sources src on src.id = s.source_id
            where s.is_published = true and s.search_tsv @@ ${ORQ}
            order by ts_rank(s.search_tsv, ${ORQ}) desc, s.published_at desc nulls last, s.id
            limit ${textLimit}`,
          [statement]
        )
      : Promise.resolve([] as SigRow[]),
    codes.length
      ? q<{ code: string; type: 'claim' | 'bridge_claim'; statement: string; test: string | null }>(
          `select code, 'claim'::text as type, statement, test
             from claims where code = any($1::text[]) and is_frame = false
           union all
           select code, 'bridge_claim'::text as type, statement, test
             from bridge_claims where code = any($1::text[])
           order by code`,
          [codes]
        )
      : Promise.resolve([] as { code: string; type: 'claim' | 'bridge_claim'; statement: string; test: string | null }[]),
    q<{ published_at: string | null }>(
      `select to_char(published_at, 'YYYY-MM-DD') as published_at
         from signals where is_published = true and published_at is not null`
    ),
  ]);
  const scanned = scannedRow[0]?.n ?? 0;
  const corpusRecency = quarterBuckets(corpusDateRows.map((r) => r.published_at));

  // 2) Merge: claim-matched first (recency order), then text-only matches (rank
  //    order). Tag assignment follows this order, so tags are stable per corpus.
  const textRankById = new Map(textMatched.map((r) => [r.id, r.rank ?? 0]));
  const merged: { row: SigRow; via: ('claim' | 'text')[] }[] = [];
  const seen = new Set<string>();
  for (const row of claimMatched) {
    seen.add(row.id);
    merged.push({ row, via: textRankById.has(row.id) ? ['claim', 'text'] : ['claim'] });
  }
  for (const row of textMatched) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push({ row, via: ['text'] });
  }

  // 3) Evidence for the mapped codes: directions per (signal, code) + public
  //    excerpts. Never selects evidence.note (admin-only).
  const evRows = codes.length
    ? await q<EvRow>(
        `select coalesce(c.code, b.code) as code, e.direction::text as direction,
                e.excerpt, e.signal_id
           from evidence e
           left join claims c on e.target_type = 'claim' and c.id = e.target_id and c.is_frame = false
           left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
          where coalesce(c.code, b.code) = any($1::text[])
          order by e.created_at desc, e.id`,
        [codes]
      )
    : [];
  const directionsBySignal = new Map<string, Record<string, Direction>>();
  for (const e of evRows) {
    if (!e.signal_id) continue;
    const m = directionsBySignal.get(e.signal_id) ?? {};
    // First row wins per (signal, code): rows are recency-ordered and the sync
    // writes one row per touch, so collisions only occur on legacy duplicates.
    if (!(e.code in m)) m[e.code] = e.direction;
    directionsBySignal.set(e.signal_id, m);
  }

  // 4) Assemble every matched signal with tags, directions, and stances. Tags
  //    are assigned over this FULL merged order (before the relevance split
  //    below) so a signal's tag never changes depending on whether it clears
  //    the relevance bar.
  const allMatched: ThesisPackSignal[] = merged.map(({ row, via }, i) => {
    const directions = directionsBySignal.get(row.id) ?? {};
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
      claim_touches: row.claim_touches,
      evidenceType: row.evidence_type ?? null,
      matched_via: via,
      rank: textRankById.get(row.id) ?? null,
      directions,
      stance: stanceOf(directions),
      relevance: null,
      relevanceWhy: null,
    };
  });
  const tagBySignal = new Map(allMatched.map((s) => [s.id, s.tag]));

  // 4b) The thesis-relevance pass. Only ever narrows (below the threshold ->
  //     peripheral); a missing or failed call keeps every signal, matching the
  //     pack's pre-existing behaviour exactly.
  let relevanceApplied = false;
  const notes: string[] = [];
  if (opts.scoreRelevance && statement && allMatched.length) {
    try {
      const scores = await opts.scoreRelevance(
        statement,
        allMatched.map((s) => ({ signal_id: s.id, title: s.title, summary: s.summary }))
      );
      const byId = new Map(scores.map((s) => [s.signal_id, s]));
      for (const s of allMatched) {
        const scored = byId.get(s.id);
        if (!scored) continue;
        s.relevance = Math.min(1, Math.max(0, Number(scored.relevance) || 0));
        s.relevanceWhy = String(scored.why ?? '').slice(0, 120) || null;
      }
      relevanceApplied = true;
    } catch {
      notes.push(
        'Relevance scoring failed; every matched signal is shown together with no peripheral split.'
      );
    }
  }
  const signals = allMatched.filter((s) => s.relevance === null || s.relevance >= THESIS_RELEVANCE_MIN);
  const peripheral = allMatched.filter((s) => s.relevance !== null && s.relevance < THESIS_RELEVANCE_MIN);
  const peripheralIds = new Set(peripheral.map((s) => s.id));

  const claims: ThesisPackClaim[] = claimRows.map((r) => ({
    code: r.code,
    type: r.type,
    statement: r.statement,
    test: r.test,
    href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
    signal_count: signals.filter((s) => s.claim_touches.includes(r.code)).length,
  }));

  // Evidence excerpts feed the narrative (lib/thesis/generate.ts), so a peripheral
  // signal's excerpt is dropped here too, not just left uncited by the allowlist.
  const evidence: ThesisPackEvidence[] = evRows
    .filter((e): e is EvRow & { excerpt: string } => !!e.excerpt && !!e.excerpt.trim())
    .filter((e) => !e.signal_id || !peripheralIds.has(e.signal_id))
    .slice(0, 40)
    .map((e) => ({
      code: e.code,
      direction: e.direction,
      excerpt: e.excerpt.trim(),
      signal_id: e.signal_id,
      signal_tag: e.signal_id ? tagBySignal.get(e.signal_id) ?? null : null,
    }));

  // 5) Stats, all in code, over the relevance-passing `signals` only.
  const stances = { supports: 0, contradicts: 0, mixed: 0, neutral: 0, untyped: 0 };
  for (const s of signals) stances[s.stance]++;
  const touchDirections = { supports: 0, contradicts: 0, neutral: 0 };
  for (const s of signals) for (const d of Object.values(s.directions)) touchDirections[d]++;
  const significance = { high: 0, medium: 0, low: 0 };
  for (const s of signals) significance[s.significance]++;

  // Evidence-type tally, over the relevant (non-peripheral) signals only. A
  // field study and a product launch stop counting the same: each bucket
  // carries its own stance breakdown, and 'unclassified' holds the null rows.
  const mkTypeTally = () => ({ total: 0, supports: 0, contradicts: 0, mixed: 0, neutral: 0, untyped: 0 });
  const byType: ThesisStats['byType'] = {
    experiment: mkTypeTally(), statistics: mkTypeTally(), survey: mkTypeTally(),
    projection: mkTypeTally(), announcement: mkTypeTally(), analysis: mkTypeTally(),
    other: mkTypeTally(), unclassified: mkTypeTally(),
  };
  for (const s of signals) {
    const bucket = byType[s.evidenceType ?? 'unclassified'];
    bucket.total++;
    bucket[s.stance]++;
  }
  const measured = { supports: 0, contradicts: 0 };
  for (const t of MEASURED_EVIDENCE_TYPES) {
    measured.supports += byType[t].supports;
    measured.contradicts += byType[t].contradicts;
  }
  const asserted = { supports: 0, contradicts: 0 };
  for (const t of ASSERTED_EVIDENCE_TYPES) {
    asserted.supports += byType[t].supports;
    asserted.contradicts += byType[t].contradicts;
  }

  const lensCounts = new Map<SignalLens, number>();
  for (const s of signals) for (const l of s.lenses) lensCounts.set(l, (lensCounts.get(l) ?? 0) + 1);
  const lenses = [...lensCounts.entries()]
    .map(([lens, n]) => ({ lens, n }))
    .sort((a, b) => b.n - a.n || a.lens.localeCompare(b.lens));

  const domainCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.source_domain) domainCounts.set(s.source_domain, (domainCounts.get(s.source_domain) ?? 0) + 1);
  }
  const topDomains = [...domainCounts.entries()]
    .map(([domain, n]) => ({ domain, n }))
    .sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
    .slice(0, 8);
  // The discovery learning loop's per-domain track record (seen/approved), when the
  // domain has been through triage. Public operational metadata (like the home
  // page's pipeline analytics), so it is safe in the shareable pack.
  const track = topDomains.length
    ? await q<{ domain: string; seen: number; approved: number }>(
        `select regexp_replace(lower(source_domain), '^www\\.', '') as domain,
                count(*)::int as seen,
                count(*) filter (where triage_status = 'approved' or triage_reason like 'unanalyzable:%')::int as approved
           from signal_candidates
          where source_domain is not null and triage_status <> 'pending'
            and regexp_replace(lower(source_domain), '^www\\.', '') = any($1::text[])
          group by 1`,
        [topDomains.map((d) => d.domain)]
      )
    : [];
  const trackByDomain = new Map(track.map((t) => [t.domain, t]));
  const domains = topDomains.map((d) => ({
    domain: d.domain,
    n: d.n,
    seen: trackByDomain.get(d.domain)?.seen ?? null,
    approved: trackByDomain.get(d.domain)?.approved ?? null,
  }));

  const dates = signals.map((s) => s.published_at).filter((d): d is string => !!d).sort();
  const recency = quarterBuckets(signals.map((s) => s.published_at));
  const withoutNote: Omit<ThesisStats, 'corpusNote'> = {
    scanned,
    matched: signals.length,
    peripheral: peripheral.length,
    byMatch: {
      claim: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'claim').length,
      text: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'text').length,
      both: signals.filter((s) => s.matched_via.length === 2).length,
    },
    stances,
    touchDirections,
    significance,
    byType,
    measured,
    asserted,
    lenses,
    recency,
    recencyShare: quarterShare(recency, corpusRecency),
    domains,
    firstPublished: dates[0] ?? null,
    lastPublished: dates[dates.length - 1] ?? null,
    oneSided: stances.supports >= 3 && stances.contradicts === 0 && stances.mixed === 0,
    thin: signals.length < 5,
  };
  const stats: ThesisStats = {
    ...withoutNote,
    corpusNote: corpusNoteFor(withoutNote, codes.length > 0, relevanceApplied),
  };

  return {
    thesis_id: thesis.id,
    statement,
    generated_at: new Date().toISOString(),
    claims,
    signals,
    peripheral,
    evidence,
    stats,
    delta: computeDelta(signals, prev),
    notes,
  };
}

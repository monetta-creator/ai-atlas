import type {
  Direction, SignalContext, Significance, SignalOrigin,
  HypothesisDelta, HypothesisPack, HypothesisPackEvidence, HypothesisPackSignal, HypothesisStats,
} from '../types';

// The deterministic core of a hypothesis report: retrieval + stats, zero AI,
// zero randomness. Given the same corpus and the same hypothesis, this produces
// the same pack byte-for-byte (generated_at aside) — every ORDER BY carries a
// stable id tiebreaker, tags are assigned in that order, and all stats are
// computed in code.
//
// Query access is INJECTED (`Q`) rather than imported from lib/db so the
// determinism test can drive the exact production SQL from plain Node. Only
// type-only imports plus other pure modules (extensioned, for Node's
// type-stripping loader) may be imported here.
//
// GUEST-SAFE BY CONSTRUCTION: a saved report is publicly shareable, so nothing
// in the personal layer may enter the pack. The queries below never select
// conviction, conviction_label, rationales, evidence.note, or reliability_prior.

import { domainOfUrl, quarterBuckets, ORQ } from '../pack-shared.ts';
import type { Q } from '../pack-shared.ts';

export interface HypothesisInput {
  id: string;
  code: string;
  statement: string;
  test: string;
}

export interface PrevRun {
  id: string;
  generated_at: string;   // ISO
  signal_ids: string[];
}

const TEXT_LIMIT = 60;   // text-match cap; touch-matched signals are never capped

const SIG_COLS = `
  s.id, s.title, s.summary, s.significance::text as significance,
  s.context::text as context, s.touches,
  to_char(s.published_at, 'YYYY-MM-DD') as published_at,
  s.origin::text as origin,
  src.title as source_title, src.url as source_url`;

interface SigRow {
  id: string;
  title: string;
  summary: string | null;
  significance: Significance;
  context: SignalContext;
  touches: string[];
  published_at: string | null;
  origin: SignalOrigin;
  source_title: string | null;
  source_url: string | null;
  rank?: number;
}

interface EvRow {
  direction: Direction;
  excerpt: string | null;
  signal_id: string | null;
}

// The deterministic coverage statement. Plain sentences built from the numbers
// (never an em dash: rendered UI copy).
function corpusNoteFor(s: Omit<HypothesisStats, 'corpusNote'>): string {
  const parts: string[] = [];
  parts.push(
    `${s.matched} of ${s.scanned} published signals in the Atlas matched this hypothesis ` +
    `(${s.byMatch.touch + s.byMatch.both} via direct touches, ${s.byMatch.text} via text match only).`
  );
  const typed = s.matched - s.directions.untyped;
  parts.push(
    `Direction data covers ${typed} of ${s.matched} matched signals: ` +
    `${s.directions.supports} supporting, ${s.directions.contradicts} contradicting, ` +
    `${s.directions.neutral} neutral.`
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
  signals: HypothesisPackSignal[],
  prev: PrevRun | null
): HypothesisDelta | null {
  if (!prev) return null;
  const prevIds = new Set(prev.signal_ids);
  const currentIds = new Set(signals.map((s) => s.id));
  const fresh = signals.filter((s) => !prevIds.has(s.id));
  const directions = { supports: 0, contradicts: 0, neutral: 0, untyped: 0 };
  for (const s of fresh) directions[s.direction ?? 'untyped']++;
  return {
    prev_report_id: prev.id,
    prev_generated_at: prev.generated_at,
    new_signal_tags: fresh.map((s) => s.tag),
    removed_count: prev.signal_ids.filter((id) => !currentIds.has(id)).length,
    new_directions: directions,
  };
}

export async function buildHypothesisPackCore(
  q: Q,
  hyp: HypothesisInput,
  prev: PrevRun | null,
  opts: { textLimit?: number } = {}
): Promise<HypothesisPack> {
  const statement = hyp.statement.trim();
  const textLimit = opts.textLimit ?? TEXT_LIMIT;

  // 1) Corpus size + the two retrieval passes, all deterministic SQL.
  const [scannedRow, touchMatched, textMatched, evRows] = await Promise.all([
    q<{ n: number }>(`select count(*)::int as n from signals where is_published = true`),
    q<SigRow>(
      `select ${SIG_COLS}
         from signals s left join sources src on src.id = s.source_id
        where s.is_published = true and s.touches @> array[$1]::text[]
        order by s.published_at desc nulls last, s.id`,
      [hyp.code]
    ),
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
    // Evidence on the hypothesis: direction per signal + public excerpts.
    // Never selects evidence.note (admin-only).
    q<EvRow>(
      `select e.direction::text as direction, e.excerpt, e.signal_id
         from evidence e
        where e.hypothesis_id = $1
        order by e.created_at desc, e.id`,
      [hyp.id]
    ),
  ]);
  const scanned = scannedRow[0]?.n ?? 0;

  // 2) Merge: touch-matched first (recency order), then text-only matches (rank
  //    order). Tag assignment follows this order, so tags are stable per corpus.
  const textRankById = new Map(textMatched.map((r) => [r.id, r.rank ?? 0]));
  const merged: { row: SigRow; via: ('touch' | 'text')[] }[] = [];
  const seen = new Set<string>();
  for (const row of touchMatched) {
    seen.add(row.id);
    merged.push({ row, via: textRankById.has(row.id) ? ['touch', 'text'] : ['touch'] });
  }
  for (const row of textMatched) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push({ row, via: ['text'] });
  }

  // Direction per signal from its materialized evidence (first row wins:
  // recency-ordered, and the sync writes one row per signal).
  const directionBySignal = new Map<string, Direction>();
  for (const e of evRows) {
    if (!e.signal_id) continue;
    if (!directionBySignal.has(e.signal_id)) directionBySignal.set(e.signal_id, e.direction);
  }

  // 3) Assemble the pack signals with tags and directions.
  const signals: HypothesisPackSignal[] = merged.map(({ row, via }, i) => ({
    id: row.id,
    tag: `S${i + 1}`,
    title: row.title,
    summary: row.summary,
    significance: row.significance,
    context: row.context,
    published_at: row.published_at,
    origin: row.origin,
    source_title: row.source_title,
    source_url: row.source_url,
    source_domain: domainOfUrl(row.source_url),
    matched_via: via,
    rank: textRankById.get(row.id) ?? null,
    direction: directionBySignal.get(row.id) ?? null,
  }));
  const tagBySignal = new Map(signals.map((s) => [s.id, s.tag]));

  const evidence: HypothesisPackEvidence[] = evRows
    .filter((e): e is EvRow & { excerpt: string } => !!e.excerpt && !!e.excerpt.trim())
    .slice(0, 40)
    .map((e) => ({
      direction: e.direction,
      excerpt: e.excerpt.trim(),
      signal_id: e.signal_id,
      signal_tag: e.signal_id ? tagBySignal.get(e.signal_id) ?? null : null,
    }));

  // 4) Stats, all in code.
  const directions = { supports: 0, contradicts: 0, neutral: 0, untyped: 0 };
  for (const s of signals) directions[s.direction ?? 'untyped']++;
  const significance = { high: 0, medium: 0, low: 0 };
  for (const s of signals) significance[s.significance]++;

  const contextCounts = new Map<SignalContext, number>();
  for (const s of signals) contextCounts.set(s.context, (contextCounts.get(s.context) ?? 0) + 1);
  const contexts = [...contextCounts.entries()]
    .map(([context, n]) => ({ context, n }))
    .sort((a, b) => b.n - a.n || a.context.localeCompare(b.context));

  const domainCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.source_domain) domainCounts.set(s.source_domain, (domainCounts.get(s.source_domain) ?? 0) + 1);
  }
  const domains = [...domainCounts.entries()]
    .map(([domain, n]) => ({ domain, n }))
    .sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
    .slice(0, 8);

  const dates = signals.map((s) => s.published_at).filter((d): d is string => !!d).sort();
  const withoutNote: Omit<HypothesisStats, 'corpusNote'> = {
    scanned,
    matched: signals.length,
    byMatch: {
      touch: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'touch').length,
      text: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'text').length,
      both: signals.filter((s) => s.matched_via.length === 2).length,
    },
    directions,
    significance,
    contexts,
    recency: quarterBuckets(signals.map((s) => s.published_at)),
    domains,
    firstPublished: dates[0] ?? null,
    lastPublished: dates[dates.length - 1] ?? null,
    oneSided: directions.supports >= 3 && directions.contradicts === 0,
    thin: signals.length < 5,
  };
  const stats: HypothesisStats = { ...withoutNote, corpusNote: corpusNoteFor(withoutNote) };

  return {
    hypothesis_id: hyp.id,
    code: hyp.code,
    statement,
    test: hyp.test,
    generated_at: new Date().toISOString(),
    signals,
    evidence,
    stats,
    delta: computeDelta(signals, prev),
  };
}

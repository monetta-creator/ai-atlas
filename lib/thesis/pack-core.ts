import type {
  Direction, Significance, SignalLens, SignalOrigin,
  ThesisDelta, ThesisPack, ThesisPackClaim, ThesisPackEvidence, ThesisPackSignal, ThesisStats,
} from '../types';

// The deterministic core of a thesis report: retrieval + stats, zero AI, zero
// randomness. Given the same corpus and the same thesis, this produces the same
// pack byte-for-byte (generated_at aside) — every ORDER BY carries a stable id
// tiebreaker, tags are assigned in that order, and all stats are computed in code.
//
// Query access is INJECTED (`Q`) rather than imported from lib/db so the
// determinism test (scripts/test-thesis.mjs) can drive the exact production SQL
// from plain Node. Only type-only imports are allowed in this module: it is loaded
// by Node's type stripping at test time, where a runtime import would not resolve.
//
// GUEST-SAFE BY CONSTRUCTION: a saved report is publicly shareable, so nothing in
// the personal layer may enter the pack. The queries below never select
// confidence, confidence_label, rationales, evidence.note, or reliability_prior.
// (evidence.excerpt and touch directions are public on claim pages already.)

export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

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

// websearch_to_tsquery ANDs every term; a full thesis sentence would rarely match
// any record. OR-combine the lexemes (ts_rank still ranks records matching more of
// them first) — same trick as lib/ask/retrieve.ts.
const ORQ = "replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery";

const TEXT_LIMIT = 60;   // text-match cap; claim-matched signals are never capped

const SIG_COLS = `
  s.id, s.title, s.summary, s.significance::text as significance,
  s.lenses::text[] as lenses, s.claim_touches,
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

export function domainOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
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

// 'YYYY Qn' quarter buckets over the matched signals' published dates, zero-filled
// across the span so the timeline reads continuously.
export function quarterBuckets(dates: (string | null)[]): { bucket: string; n: number }[] {
  const qs = dates
    .filter((d): d is string => !!d && /^\d{4}-\d{2}/.test(d))
    .map((d) => {
      const y = Number(d.slice(0, 4));
      const quarter = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
      return y * 4 + (quarter - 1);
    });
  if (!qs.length) return [];
  const counts = new Map<number, number>();
  for (const k of qs) counts.set(k, (counts.get(k) ?? 0) + 1);
  const min = Math.min(...qs);
  const max = Math.max(...qs);
  const out: { bucket: string; n: number }[] = [];
  for (let k = min; k <= max; k++) {
    out.push({ bucket: `${Math.floor(k / 4)} Q${(k % 4) + 1}`, n: counts.get(k) ?? 0 });
  }
  return out;
}

// The deterministic coverage statement. Plain sentences built from the numbers
// (never an em dash: rendered UI copy).
function corpusNoteFor(s: Omit<ThesisStats, 'corpusNote'>, hasCodes: boolean): string {
  const parts: string[] = [];
  parts.push(
    `${s.matched} of ${s.scanned} published signals in the Atlas matched this thesis ` +
    `(${s.byMatch.claim + s.byMatch.both} via mapped claims, ${s.byMatch.text} via text match only).`
  );
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
  opts: { textLimit?: number } = {}
): Promise<ThesisPack> {
  const codes = [...new Set(thesis.claim_codes)];
  const statement = thesis.statement.trim();
  const textLimit = opts.textLimit ?? TEXT_LIMIT;

  // 1) Corpus size + the two retrieval passes + mapped-claim resolution, all
  //    deterministic SQL (stable tiebreakers everywhere).
  const [scannedRow, claimMatched, textMatched, claimRows] = await Promise.all([
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
  ]);
  const scanned = scannedRow[0]?.n ?? 0;

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

  // 4) Assemble the pack signals with tags, directions, and stances.
  const signals: ThesisPackSignal[] = merged.map(({ row, via }, i) => {
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
      matched_via: via,
      rank: textRankById.get(row.id) ?? null,
      directions,
      stance: stanceOf(directions),
    };
  });
  const tagBySignal = new Map(signals.map((s) => [s.id, s.tag]));

  const claims: ThesisPackClaim[] = claimRows.map((r) => ({
    code: r.code,
    type: r.type,
    statement: r.statement,
    test: r.test,
    href: r.type === 'bridge_claim' ? `/bridge/${r.code}` : `/claim/${encodeURIComponent(r.code)}`,
    signal_count: signals.filter((s) => s.claim_touches.includes(r.code)).length,
  }));

  const evidence: ThesisPackEvidence[] = evRows
    .filter((e): e is EvRow & { excerpt: string } => !!e.excerpt && !!e.excerpt.trim())
    .slice(0, 40)
    .map((e) => ({
      code: e.code,
      direction: e.direction,
      excerpt: e.excerpt.trim(),
      signal_id: e.signal_id,
      signal_tag: e.signal_id ? tagBySignal.get(e.signal_id) ?? null : null,
    }));

  // 5) Stats, all in code.
  const stances = { supports: 0, contradicts: 0, mixed: 0, neutral: 0, untyped: 0 };
  for (const s of signals) stances[s.stance]++;
  const touchDirections = { supports: 0, contradicts: 0, neutral: 0 };
  for (const s of signals) for (const d of Object.values(s.directions)) touchDirections[d]++;
  const significance = { high: 0, medium: 0, low: 0 };
  for (const s of signals) significance[s.significance]++;

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
  const withoutNote: Omit<ThesisStats, 'corpusNote'> = {
    scanned,
    matched: signals.length,
    byMatch: {
      claim: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'claim').length,
      text: signals.filter((s) => s.matched_via.length === 1 && s.matched_via[0] === 'text').length,
      both: signals.filter((s) => s.matched_via.length === 2).length,
    },
    stances,
    touchDirections,
    significance,
    lenses,
    recency: quarterBuckets(signals.map((s) => s.published_at)),
    domains,
    firstPublished: dates[0] ?? null,
    lastPublished: dates[dates.length - 1] ?? null,
    oneSided: stances.supports >= 3 && stances.contradicts === 0 && stances.mixed === 0,
    thin: signals.length < 5,
  };
  const stats: ThesisStats = { ...withoutNote, corpusNote: corpusNoteFor(withoutNote, codes.length > 0) };

  return {
    thesis_id: thesis.id,
    statement,
    generated_at: new Date().toISOString(),
    claims,
    signals,
    evidence,
    stats,
    delta: computeDelta(signals, prev),
  };
}

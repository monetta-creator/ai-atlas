import { q } from '@/lib/db';
import { ORQ } from '@/lib/pack-shared';
import type { ValidIdsPlain } from '@/lib/ask/verify';
import { getAskPrefs } from '@/lib/data/ask';
import { embedQuery, embedModel } from '@/lib/embed/client';
import { fuseOrder } from './fusion';

// Server-only retrieval for "Ask the Atlas". Hybrid lexical + structural, no
// embeddings (see 0020_ask_fts.sql for the rationale). Two things are assembled:
//
//  1. A compact SKELETON of every citable record (code/slug + one line), always
//     included so the model sees the complete valid-ID namespace on every call.
//  2. DEEP DETAIL for the records the question actually matched: Postgres
//     full-text search over the text-heavy columns, plus exact code/slug lookups
//     with one-hop neighbour expansion (evidence, touching signals, linked
//     claims) so multi-record questions have the rows they need.
//
// Two modes share this module. 'admin' (/ask and /api/ask, gated on isAdmin)
// may include the personal layer (domain notes, evidence notes, draft signals)
// in the context. 'portal' (/api/portal/ask, the key-gated team surface) is
// guest-safe by construction: personal columns are never selected (nulled in
// SQL, not filtered after), signals are published-only, and evidence is
// excerpt-only. Both modes get the article-excerpt leg over the 0029 tsvectors;
// it only ever surfaces text through a published signal or a publicly cited
// source, so it is guest-safe in either mode.

interface ValidIdSet {
  claims: Set<string>;
  bridges: Set<string>;
  stances: Set<string>;
  questions: Set<string>;
  concepts: Set<string>;
  threads: Set<string>;
}

export interface AskNamespace {
  skeleton: string;
  validIds: ValidIdSet;
  stanceToQuestion: Record<string, string>;
}

export type AskMode = 'admin' | 'portal';

export interface AskContext extends AskNamespace {
  detail: string;
  hitCount: number;
  // Best ts_rank across every FTS leg that matched, 0 when none did. Feeds
  // lib/ask/lanes.ts decideLane: a high hitCount of weakly-related rows should
  // not count as "covered" the way a handful of sharply on-topic rows does.
  maxRank: number;
  // Best cosine similarity across the vector leg (migration 0066), 0 when the
  // embedding call failed or nothing matched. ALWAYS populated, even when
  // ask_prefs.retrieval is 'fts': it only reorders context in hybrid mode, but
  // it is always computed so it can be measured against maxRank before the
  // pref ever flips (see scripts/ab-retrieval.mjs, hybrid-retrieval plan step 4).
  maxSim: number;
  // True when the question named a claim code, concept slug, question slug,
  // bridge code, or research-thread slug that detectIds resolved (the same
  // signal that already drove the explicit-match retrieval path below).
  explicit: boolean;
  // Signals and papers have no stable short code, so each retrieved one gets a
  // per-request tag on ONE shared counter (signals S1, S2, ... papers P3,
  // P4, ..., scan/intel items I5, I6, ..., intel facts X7, X8, ...) the model
  // can cite as [signal S1] / [paper P3] / [item I5] / [fact X7]; the route
  // ships the combined tag -> id map to the client so citations resolve by
  // tag prefix (S/P to /signals or /research by uuid; I/X to the key-gated
  // dataset that carries the row, since scan/intel items and facts have no
  // Atlas page of their own). An item's id carries its source table as a
  // "scan:<uuid>" or "intel:<uuid>" prefix (scan_items and intel_items share
  // the I prefix but resolve to different datasets); a fact's id is a bare uuid.
  signalRefs: { tag: string; id: string }[];
  // Every primary record actually retrieved (explicit, FTS, or vector legs),
  // in final ranked order, one entry per distinct record (evidence/article/
  // concept-link blocks excluded, since those are supporting text, not a
  // citable record). Added for scripts/ab-retrieval-run.mts (the hybrid-
  // retrieval plan's measurement step): recall@10 needs the ranked hit list
  // straight from retrieval, not a re-parse of the rendered detail text.
  retrievedKeys: { kind: string; key: string }[];
}

const MAX_DETAIL = 11000; // char budget for the deep-detail blob
const FIELD_CAP = 600; // per long field, keeps any one record bounded

// ts_rank normalization flag for the LONG-document legs (signals with full
// briefs, papers, evidence, retained article text): 1 divides rank by
// 1 + log(document length), so a long generic brief that says "model" fifteen
// times stops outranking a short, exactly-on-topic record. The short-record
// legs (claims, stances, concepts) keep the default: their lengths are uniform
// and the correction would only add noise. (ORQ itself: lib/pack-shared.ts.)
const RANK_NORM = 1;

const clip = (s: string | null | undefined, n = FIELD_CAP): string => {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)} ...` : t;
};

// Join non-empty lines (drops false/null/'' entries) so optional fields never
// leave a blank line in a record block.
const lines = (...xs: (string | false | null | undefined)[]): string =>
  xs.filter(Boolean).join('\n');

// ---------------------------------------------------------------- skeleton
// One short line per citable record, prefixed with its exact citation token so
// the model copies a string it has already seen. Built once per request.
export async function loadNamespace(): Promise<AskNamespace> {
  const [questions, stances, claims, bridges, concepts, threads] = await Promise.all([
    q<{ slug: string; sort_order: number; title: string }>(
      `select slug, sort_order, title from questions order by sort_order`
    ),
    q<{ code: string; title: string; q_slug: string }>(
      `select s.code, s.title, qn.slug as q_slug
         from stances s join questions qn on qn.id = s.question_id
        where s.code is not null order by s.code`
    ),
    q<{ code: string; statement: string; is_frame: boolean }>(
      `select code, statement, is_frame from claims where code is not null order by code`
    ),
    q<{ code: string; statement: string }>(
      `select code, statement from bridge_claims where code is not null order by code`
    ),
    q<{ slug: string; name: string; short_definition: string }>(
      `select slug, name, short_definition from concepts order by name`
    ),
    q<{ slug: string; title: string; question: string; status: string }>(
      `select slug, title, question, status::text as status from research_threads order by title`
    ),
  ]);

  const validIds: ValidIdSet = {
    claims: new Set(claims.map((c) => c.code)),
    bridges: new Set(bridges.map((b) => b.code)),
    stances: new Set(stances.map((s) => s.code)),
    questions: new Set(questions.map((qn) => qn.slug)),
    concepts: new Set(concepts.map((c) => c.slug)),
    threads: new Set(threads.map((t) => t.slug)),
  };
  const stanceToQuestion: Record<string, string> = {};
  for (const s of stances) stanceToQuestion[s.code] = s.q_slug;

  const skeleton = [
    'QUESTIONS',
    ...questions.map((x) => `[Q ${x.slug}] Q${x.sort_order}: ${x.title}`),
    '',
    'STANCES (candidate answers, each under a question)',
    ...stances.map((x) => `[stance ${x.code}] ${x.title} (under Q ${x.q_slug})`),
    '',
    'CLAIMS',
    ...claims.map((x) => `[claim ${x.code}]${x.is_frame ? ' (frame)' : ''} ${x.statement}`),
    '',
    'BRIDGE CLAIMS (links between domains)',
    ...bridges.map((x) => `[bridge ${x.code}] ${x.statement}`),
    '',
    'CONCEPTS',
    ...concepts.map((x) => `[concept ${x.slug}] ${x.name}: ${x.short_definition}`),
    '',
    'RESEARCH THREADS (living syntheses over the recent AI literature)',
    ...threads.map((x) => `[thread ${x.slug}]${x.status !== 'open' ? ` (${x.status})` : ''} ${x.title}: ${x.question}`),
  ].join('\n');

  return { skeleton, validIds, stanceToQuestion };
}

// Serializable namespace for the client component (Sets -> arrays).
export async function getAskClientData(): Promise<ValidIdsPlain> {
  const ns = await loadNamespace();
  return {
    claims: [...ns.validIds.claims],
    bridges: [...ns.validIds.bridges],
    stances: [...ns.validIds.stances],
    questions: [...ns.validIds.questions],
    concepts: [...ns.validIds.concepts],
    threads: [...ns.validIds.threads],
    stanceToQuestion: ns.stanceToQuestion,
  };
}

// ---------------------------------------------------------------- detail
type Block = { key: string; text: string; rank: number };

// Detect citable codes/slugs literally present in the query, then trigram-correct
// slug-shaped tokens that did not match exactly (e.g. "unit economics").
async function detectIds(
  query: string,
  ns: AskNamespace
): Promise<{ claims: string[]; bridges: string[]; concepts: string[]; questions: string[]; threads: string[] }> {
  const claims = new Set<string>();
  const bridges = new Set<string>();
  const concepts = new Set<string>();
  const questions = new Set<string>();
  const threads = new Set<string>();

  for (const m of query.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (ns.validIds.claims.has(m[0])) claims.add(m[0]);
  }
  for (const m of query.matchAll(/\bF\d+\b/gi)) {
    const c = m[0].toUpperCase();
    if (ns.validIds.claims.has(c)) claims.add(c);
  }
  for (const m of query.matchAll(/\bB\d+\b/gi)) {
    const c = m[0].toUpperCase();
    if (ns.validIds.bridges.has(c)) bridges.add(c);
  }
  const fuzzy: string[] = [];
  for (const m of query.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi)) {
    const s = m[0].toLowerCase();
    if (ns.validIds.concepts.has(s)) concepts.add(s);
    else if (ns.validIds.questions.has(s)) questions.add(s);
    else if (ns.validIds.threads.has(s)) threads.add(s);
    else fuzzy.push(s);
  }
  // Fuzzy-correct typo'd slugs against concept/question slugs via pg_trgm.
  for (const tok of fuzzy.slice(0, 4)) {
    const hit = await q<{ kind: string; id: string }>(
      `select kind, id from (
         select 'concept' as kind, slug as id, similarity(slug, $1) as s from concepts
         union all
         select 'question' as kind, slug as id, similarity(slug, $1) as s from questions
       ) t where s > 0.45 order by s desc limit 1`,
      [tok]
    );
    if (hit[0]?.kind === 'concept') concepts.add(hit[0].id);
    else if (hit[0]?.kind === 'question') questions.add(hit[0].id);
  }

  return {
    claims: [...claims],
    bridges: [...bridges],
    concepts: [...concepts],
    questions: [...questions],
    threads: [...threads],
  };
}

export async function buildAskContext(
  query: string,
  opts: { mode?: AskMode; tagStart?: number; ns?: AskNamespace } = {}
): Promise<AskContext> {
  const mode = opts.mode ?? 'admin';
  // Multi-turn: signal tags are minted per REQUEST, so without an offset a
  // conversation's turn 2 would reuse S1 for a different signal and the model
  // (which sees its own prior [signal S1] citations) would silently mislink.
  // The client sends the highest suffix it has seen; new tags continue from it.
  const tagStart = opts.tagStart ?? 0;
  // The routes classify the question in parallel and need the namespace for
  // the beat description; pass it through here so that call doesn't pay for
  // loadNamespace's queries twice.
  const ns = opts.ns ?? await loadNamespace();
  const trimmed = query.trim();
  if (!trimmed) return { ...ns, detail: '', hitCount: 0, maxRank: 0, maxSim: 0, explicit: false, signalRefs: [], retrievedKeys: [] };

  const seen = new Set<string>();
  const blocks: Block[] = [];
  let maxRank = 0;
  const push = (key: string, text: string, rank = 0) => {
    if (rank > maxRank) maxRank = rank;
    if (!text || seen.has(key)) return;
    seen.add(key);
    blocks.push({ key, text, rank });
  };
  // Assign a stable per-request tag to each retrieved signal (S...) and paper
  // (P...) so the model can cite them and the client can resolve tags back to
  // record pages. ONE shared counter across both kinds: the client tracks a
  // single max-suffix offset, so the sequences must never reuse a number.
  let tagCount = tagStart;
  const signalTags = new Map<string, string>(); // signal id -> tag
  const paperTags = new Map<string, string>();  // paper id -> tag
  const itemTags = new Map<string, string>();   // "scan:<uuid>" | "intel:<uuid>" -> tag
  const factTags = new Map<string, string>();   // intel_facts id -> tag
  const tagFor = (id: string) => {
    let t = signalTags.get(id);
    if (!t) { t = `S${++tagCount}`; signalTags.set(id, t); }
    return t;
  };
  const ptagFor = (id: string) => {
    let t = paperTags.get(id);
    if (!t) { t = `P${++tagCount}`; paperTags.set(id, t); }
    return t;
  };
  const itemTagFor = (compositeId: string) => {
    let t = itemTags.get(compositeId);
    if (!t) { t = `I${++tagCount}`; itemTags.set(compositeId, t); }
    return t;
  };
  const factTagFor = (id: string) => {
    let t = factTags.get(id);
    if (!t) { t = `X${++tagCount}`; factTags.set(id, t); }
    return t;
  };

  // 1) Explicit code/slug matches + one-hop neighbours (highest priority).
  const ids = await detectIds(trimmed, ns);

  if (ids.claims.length) {
    // Portal mode nulls domain_note in SQL (personal layer) rather than
    // filtering after the fact, so the column never leaves the database.
    const rows = await q<{ code: string; statement: string; test: string | null; domain_note: string | null; is_frame: boolean }>(
      `select code, statement, test,
              ${mode === 'admin' ? 'domain_note' : 'null::text as domain_note'}, is_frame
         from claims where code = any($1::text[])`,
      [ids.claims]
    );
    for (const r of rows) {
      push(`claim:${r.code}`, lines(
        `[claim ${r.code}]${r.is_frame ? ' (frame)' : ''} ${clip(r.statement)}`,
        r.test && `  Falsifying test: ${clip(r.test)}`,
        r.domain_note && `  Domain note: ${clip(r.domain_note, 200)}`,
      ));
    }
    const ev = await q<{ code: string; direction: string; excerpt: string | null; note: string | null }>(
      mode === 'admin'
        ? `select c.code, e.direction, e.excerpt, e.note
             from evidence e join claims c on c.id = e.target_id
            where e.target_type = 'claim' and c.code = any($1::text[])
              and (e.excerpt is not null or e.note is not null)
            order by e.created_at desc limit 12`
        : `select c.code, e.direction, e.excerpt, null::text as note
             from evidence e join claims c on c.id = e.target_id
            where e.target_type = 'claim' and c.code = any($1::text[])
              and e.excerpt is not null
              and (e.signal_id is null
                   or exists (select 1 from signals g where g.id = e.signal_id and g.is_published))
            order by e.created_at desc limit 12`,
      [ids.claims]
    );
    for (const e of ev) {
      push(`ev:claim:${e.code}:${clip(e.excerpt ?? e.note, 40)}`,
        `Evidence for [claim ${e.code}] (${e.direction}): ${clip(e.excerpt ?? e.note, 300)}`);
    }
  }

  if (ids.bridges.length) {
    const rows = await q<{ code: string; statement: string; test: string | null; note: string | null; domain_from: string; domain_to: string }>(
      `select code, statement, test, note, domain_from, domain_to from bridge_claims where code = any($1::text[])`,
      [ids.bridges]
    );
    for (const r of rows) {
      push(`bridge:${r.code}`, lines(
        `[bridge ${r.code}] ${clip(r.statement)} (${r.domain_from} -> ${r.domain_to})`,
        r.test && `  Falsifying test: ${clip(r.test)}`,
        r.note && `  Note: ${clip(r.note, 200)}`,
      ));
    }
  }

  // Signals touching any explicitly named claim/bridge code.
  const touchCodes = [...ids.claims, ...ids.bridges];
  if (touchCodes.length) {
    const sig = await q<{ id: string; title: string; summary: string | null; claim_touches: string[]; is_published: boolean }>(
      `select id, title, summary, claim_touches, is_published from signals
        where claim_touches && $1::text[]
          ${mode === 'portal' ? 'and is_published = true' : ''}
        order by published_at desc limit 8`,
      [touchCodes]
    );
    for (const s of sig) {
      push(`sig:${s.id}`,
        `[signal ${tagFor(s.id)}] "${s.title}"${s.is_published ? '' : ' (draft)'} ${clip(s.summary, 300)} (touches ${s.claim_touches.join(', ')})`);
    }
  }

  if (ids.concepts.length) {
    const rows = await q<{ slug: string; name: string; short_definition: string; explanation: string | null; status: string }>(
      `select slug, name, short_definition, explanation, status from concepts where slug = any($1::text[])`,
      [ids.concepts]
    );
    for (const r of rows) {
      push(`concept:${r.slug}`, lines(
        `[concept ${r.slug}] ${r.name} (${r.status}): ${clip(r.short_definition)}`,
        r.explanation && `  ${clip(r.explanation)}`,
      ));
    }
    const linked = await q<{ slug: string; target_type: string; target_code: string; claim_stmt: string | null; bridge_stmt: string | null }>(
      `select cn.slug, cc.target_type, cc.target_code,
              c.statement as claim_stmt, b.statement as bridge_stmt
         from concept_claims cc
         join concepts cn on cn.id = cc.concept_id
         left join claims c on cc.target_type = 'claim' and c.code = cc.target_code
         left join bridge_claims b on cc.target_type = 'bridge_claim' and b.code = cc.target_code
        where cn.slug = any($1::text[]) and cc.status = 'confirmed'`,
      [ids.concepts]
    );
    for (const l of linked) {
      const token = l.target_type === 'bridge_claim' ? `[bridge ${l.target_code}]` : `[claim ${l.target_code}]`;
      push(`link:${l.slug}:${l.target_code}`,
        `[concept ${l.slug}] is invoked by ${token} ${clip(l.claim_stmt ?? l.bridge_stmt, 200)}`);
    }
  }

  // Explicitly named research threads: the thread plus its member papers.
  if (ids.threads.length) {
    const rows = await q<{ slug: string; title: string; question: string; synthesis: string | null; status: string }>(
      `select slug, title, question, synthesis, status::text as status
         from research_threads where slug = any($1::text[])`,
      [ids.threads]
    );
    for (const r of rows) {
      push(`thread:${r.slug}`, lines(
        `[thread ${r.slug}]${r.status !== 'open' ? ` (${r.status})` : ''} ${r.title}: ${clip(r.question, 200)}`,
        r.synthesis && `  Synthesis: ${clip(r.synthesis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), FIELD_CAP)}`,
      ));
    }
    const tp = await q<{ slug: string; id: string; title: string; relation: string; headline: string | null }>(
      `select t.slug, p.id, p.title, tp.relation::text as relation,
              p.extraction->>'headline_claim' as headline
         from thread_papers tp
         join research_threads t on t.id = tp.thread_id
         join papers p on p.id = tp.paper_id
        where t.slug = any($1::text[]) and tp.status = 'confirmed'
        order by p.published_at desc nulls last limit 10`,
      [ids.threads]
    );
    for (const p of tp) {
      push(`paper:${p.id}`,
        `[paper ${ptagFor(p.id)}] "${clip(p.title, 150)}" (${p.relation} in thread ${p.slug})${p.headline ? `: ${clip(p.headline, 250)}` : ''}`);
    }
  }

  if (ids.questions.length) {
    const rows = await q<{ slug: string; sort_order: number; title: string; summary: string | null }>(
      `select slug, sort_order, title, summary from questions where slug = any($1::text[])`,
      [ids.questions]
    );
    for (const r of rows) {
      push(`q:${r.slug}`, lines(
        `[Q ${r.slug}] Q${r.sort_order}: ${r.title}`,
        r.summary && `  ${clip(r.summary)}`,
      ));
    }
    const st = await q<{ code: string; title: string; summary: string | null; test: string; q_slug: string }>(
      `select s.code, s.title, s.summary, s.test, qn.slug as q_slug
         from stances s join questions qn on qn.id = s.question_id
        where qn.slug = any($1::text[]) and s.code is not null order by s.code`,
      [ids.questions]
    );
    for (const s of st) {
      push(`stance:${s.code}`, lines(
        `[stance ${s.code}] ${s.title} (under Q ${s.q_slug})`,
        s.summary && `  ${clip(s.summary)}`,
        `  What would move off it: ${clip(s.test, 250)}`,
      ));
    }
  }

  // 2) Full-text retrieval over the deep columns (fills in by-topic matches).
  const ftsClaimCodes = await ftsClaims(trimmed, push);
  const ftsBridgeCodes = await ftsBridges(trimmed, push);

  // One-hop signal expansion for FTS-matched claims/bridges too, not just codes
  // typed literally: "what signals touch the entry-level hiring claim" finds
  // claim 7.1 by text, and the reader still needs its touching signals. Runs
  // BEFORE stances/concepts so the detail budget (which cuts from the tail)
  // keeps the signals a claim-shaped question is really asking for.
  const ftsTouch = [...ftsClaimCodes, ...ftsBridgeCodes].filter((c) => !touchCodes.includes(c));
  if (ftsTouch.length) {
    // Relevance first (how many of the matched claims a signal touches), then
    // recency: a signal squarely about the retrieved claims beats whatever
    // happened to publish last.
    const sig = await q<{ id: string; title: string; summary: string | null; claim_touches: string[]; is_published: boolean }>(
      `select id, title, summary, claim_touches, is_published from signals
        where claim_touches && $1::text[]
          ${mode === 'portal' ? 'and is_published = true' : ''}
        order by (select count(*) from unnest(claim_touches) t where t = any($1::text[])) desc,
                 published_at desc nulls last
        limit 6`,
      [ftsTouch]
    );
    for (const s of sig) {
      push(`sig:${s.id}`,
        `[signal ${tagFor(s.id)}] "${s.title}"${s.is_published ? '' : ' (draft)'} ${clip(s.summary, 300)} (touches ${s.claim_touches.join(', ')})`);
    }
    // One-hop evidence for FTS-matched claims, mirroring the explicit-code
    // path: a claim retrieved by text carries its evidence rows, so the model
    // sees the substitution stories and not just the claim statement.
    const ftsClaimOnly = ftsClaimCodes.filter((c) => !ids.claims.includes(c));
    if (ftsClaimOnly.length) {
      const ev = await q<{ code: string; direction: string; excerpt: string | null; note: string | null }>(
        mode === 'admin'
          ? `select c.code, e.direction, e.excerpt, e.note
               from evidence e join claims c on c.id = e.target_id
              where e.target_type = 'claim' and c.code = any($1::text[])
                and (e.excerpt is not null or e.note is not null)
              order by e.created_at desc limit 8`
          : `select c.code, e.direction, e.excerpt, null::text as note
               from evidence e join claims c on c.id = e.target_id
              where e.target_type = 'claim' and c.code = any($1::text[])
                and e.excerpt is not null
                and (e.signal_id is null
                     or exists (select 1 from signals g where g.id = e.signal_id and g.is_published))
              order by e.created_at desc limit 8`,
        [ftsClaimOnly]
      );
      for (const e of ev) {
        push(`ev:claim:${e.code}:${clip(e.excerpt ?? e.note, 40)}`,
          `Evidence for [claim ${e.code}] (${e.direction}): ${clip(e.excerpt ?? e.note, 300)}`);
      }
    }
  }

  await ftsStances(trimmed, push);
  await ftsConcepts(trimmed, push);
  await ftsThreads(trimmed, push);
  await ftsSignals(trimmed, push, tagFor, mode);
  await ftsPapers(trimmed, push, ptagFor);
  await ftsEvidence(trimmed, push, mode);
  await ftsArticles(trimmed, push, tagFor);

  // When the question named explicit codes/slugs, FTS/the code lookups above
  // are the ONLY leg (the Design doc's "exact-term backstop" rule): the vector
  // leg below never reorders or adds to an explicit match's context.
  const explicit =
    ids.claims.length + ids.bridges.length + ids.concepts.length +
    ids.questions.length + ids.threads.length > 0;

  // 2.5) Vector leg (migration 0066): one embedding for the question, one
  // cosine query over every kind's chunks (joined back to the source tables
  // with the same guest-safety predicate each FTS leg above already applies),
  // reciprocal-rank-fused (k=60, lib/ask/fusion.ts) against the FTS blocks'
  // own push order. maxSim is ALWAYS computed, explicit match or not (one
  // cheap embedding + one index query), so it is populated in every path and
  // can feed lib/ask/lanes.ts's decideLane (2026-09-24: it was silently 0 for
  // every explicit question before this). The FUSION rule stays as it was:
  // an explicit code/slug match keeps the sequential FTS/explicit-lookup
  // order untouched (the "exact-term backstop" rule), never reordered by the
  // vector leg. When budget remains, vector-only hits are still MATERIALIZED
  // (pushed) after the explicit blocks for an explicit question, since a
  // block only costs its render into the char budget and a relevant
  // vector-only record is better included (at the tail) than dropped
  // entirely; they are appended, never reordered ahead of an explicit hit.
  // Best-effort throughout: an embedding-API failure must never break Ask.
  let maxSim = 0;
  let fusedKeyOrder: string[] | null = null;
  try {
    const [prefs, qvec] = await Promise.all([getAskPrefs(), embedQuery(trimmed)]);
    // Measurement hook (scripts/ab-retrieval-run.mts): ASK_RETRIEVAL_OVERRIDE
    // forces 'fts' or 'hybrid' for a call without writing ask_prefs, so the
    // A/B script can flip modes per question without touching the DB.
    const override = process.env.ASK_RETRIEVAL_OVERRIDE;
    const retrievalMode = override === 'fts' || override === 'hybrid' ? override : prefs.retrieval;
    if (qvec) {
      const vecHits = await vectorSearch(qvec, mode === 'admin');
      maxSim = vecHits[0]?.sim ?? 0;
      if (retrievalMode === 'hybrid' && vecHits.length) {
        if (!explicit) {
          const vecKeyOrder = await materializeVectorBlocks(vecHits, push, tagFor, ptagFor, itemTagFor, factTagFor);
          // Sorted by each block's own ts_rank, not push order: the fts*
          // helpers push in rank order WITHIN one call (claims, then bridges,
          // then stances, ...), but the FTS "order" the fusion guard needs to
          // protect is the true cross-kind ranking, so a high-rank bridge
          // pushed after a run of lower-rank claims still counts as an FTS
          // top hit (the p05 fix: bridge B4 ranked 3rd by ts_rank but was
          // pushed well past index 2 in call order).
          const ftsKeyOrder = [...blocks].sort((a, b) => b.rank - a.rank).map((b) => b.key);
          fusedKeyOrder = fuseOrder([ftsKeyOrder, vecKeyOrder]);
        } else {
          // Explicit match: append vector-only material, no reordering.
          await materializeVectorBlocks(vecHits, push, tagFor, ptagFor, itemTagFor, factTagFor);
        }
      }
    }
  } catch {
    // vector leg is best-effort; fall through to FTS-only ordering below.
  }

  // 3) Assemble, bounded to the char budget. When the question named explicit
  // codes/slugs, keep the sequential fill (explicit matches were pushed first
  // and deserve the whole budget). A fused hybrid order (above) wins next. A
  // BROAD FTS-only question gets a diversity pass instead: round-robin across
  // record kinds (the push-key prefix), one block per kind per cycle, so
  // stances, concepts, and threads survive a budget that sequential order
  // would spend entirely on claims and signals.
  let ordered = blocks;
  if (fusedKeyOrder) {
    const byKey = new Map(blocks.map((b) => [b.key, b]));
    const seen = new Set<string>();
    ordered = [];
    for (const k of fusedKeyOrder) {
      const b = byKey.get(k);
      if (b && !seen.has(k)) { seen.add(k); ordered.push(b); }
    }
    for (const b of blocks) if (!seen.has(b.key)) ordered.push(b);
  } else if (!explicit) {
    // Signals and evidence carry the concrete developments and substitution
    // stories a broad question is really after, so they draw two slots per
    // cycle; every other kind draws one.
    const CYCLE_WEIGHTS: Record<string, number> = { sig: 2, ev: 2 };
    const groups = new Map<string, Block[]>();
    for (const b of blocks) {
      const kind = b.key.split(':')[0];
      const g = groups.get(kind);
      if (g) g.push(b);
      else groups.set(kind, [b]);
    }
    const queues = [...groups.entries()];
    ordered = [];
    while (ordered.length < blocks.length) {
      let pushedAny = false;
      for (const [kind, queue] of queues) {
        const slots = CYCLE_WEIGHTS[kind] ?? 1;
        for (let j = 0; j < slots; j++) {
          const next = queue.shift();
          if (next) {
            ordered.push(next);
            pushedAny = true;
          }
        }
      }
      if (!pushedAny) break;
    }
  }
  let detail = '';
  for (const b of ordered) {
    if (detail.length + b.text.length + 2 > MAX_DETAIL) break;
    detail += b.text + '\n\n';
  }

  const signalRefs = [...signalTags, ...paperTags, ...itemTags, ...factTags].map(([id, tag]) => ({ tag, id }));

  const retrievedKeys: { kind: string; key: string }[] = [];
  const seenRecord = new Set<string>();
  for (const b of ordered) {
    const rec = keyToRecord(b.key);
    if (!rec) continue;
    const dk = `${rec.kind}:${rec.key}`;
    if (seenRecord.has(dk)) continue;
    seenRecord.add(dk);
    retrievedKeys.push(rec);
  }

  return { ...ns, detail: detail.trim(), hitCount: blocks.length, maxRank, maxSim, explicit, signalRefs, retrievedKeys };
}

// Maps a push() block key to the primary record it represents, or null when
// the block is supporting text (evidence excerpt, article excerpt, or a
// concept-claim link line) rather than a citable record of its own. Kinds
// mirror the gold set's vocabulary in private/ask-gold/questions.json.
function keyToRecord(key: string): { kind: string; key: string } | null {
  if (key.startsWith('ev:') || key.startsWith('art:') || key.startsWith('link:')) return null;
  const parts = key.split(':');
  switch (parts[0]) {
    case 'claim': return { kind: 'claim', key: parts[1] };
    case 'bridge': return { kind: 'bridge', key: parts[1] };
    case 'stance': return { kind: 'stance', key: parts[1] };
    case 'concept': return { kind: 'concept', key: parts[1] };
    case 'thread': return { kind: 'thread', key: parts[1] };
    case 'q': return { kind: 'question', key: parts[1] };
    case 'sig': return { kind: 'signal', key: parts[1] };
    case 'paper': return { kind: 'paper', key: parts[1] };
    case 'fact': return { kind: 'intel_fact', key: parts[1] };
    case 'item':
      if (parts[1] === 'scan') return { kind: 'scan_item', key: parts[2] };
      if (parts[1] === 'intel') return { kind: 'intel_item', key: parts[2] };
      return null;
    default: return null;
  }
}

// ------------------------------------------------------------------ vector leg
interface VecHit { kind: string; record_id: string; sim: number }

// One cosine query over every kind's chunks (aggregated to one row per
// record: the best-matching chunk), joined back to each source table with
// the SAME guest-safety predicate its FTS leg already applies. claim/bridge/
// stance/concept/thread carry no personal-layer columns to begin with, so
// they need no predicate here; scan/intel items and facts are portal/admin
// only by construction (buildAskContext is never called for a guest).
async function vectorSearch(qvec: number[], admin: boolean): Promise<VecHit[]> {
  return q<VecHit>(
    `select kind, record_id, max(1 - (vec <=> $1::vector)) as sim
       from embeddings
      where model = $2
        and (
          (kind = 'signal' and exists (
            select 1 from signals g where g.id = record_id::uuid and (g.is_published = true or $3::boolean)))
          or (kind = 'candidate' and exists (
            select 1 from signal_candidates sc join signals g on g.id = sc.signal_id and g.is_published = true
             where sc.id = record_id::uuid))
          or (kind = 'paper' and exists (
            select 1 from papers p where p.id = record_id::uuid and p.triage_status = 'kept' and p.review_status <> 'dismissed'))
          or kind in ('scan_item', 'intel_item', 'intel_fact', 'claim', 'bridge', 'stance', 'concept', 'thread')
        )
      group by kind, record_id
      order by sim desc
      limit 40`,
    [`[${qvec.join(',')}]`, embedModel(), admin]
  );
}

// Pushes a context block for every vector hit not already covered by the FTS/
// explicit legs above (push() dedupes on key, so a hit already present is a
// no-op) and returns the hits' record keys IN SIMILARITY ORDER, for RRF
// fusion against the FTS blocks' own push order.
async function materializeVectorBlocks(
  hits: VecHit[],
  push: (k: string, t: string, r?: number) => void,
  tagFor: (id: string) => string,
  ptagFor: (id: string) => string,
  itemTagFor: (id: string) => string,
  factTagFor: (id: string) => string
): Promise<string[]> {
  const need = {
    claim: new Set<string>(), bridge: new Set<string>(), stance: new Set<string>(),
    concept: new Set<string>(), thread: new Set<string>(), signal: new Set<string>(),
    paper: new Set<string>(), candidate: new Set<string>(),
    scan_item: new Set<string>(), intel_item: new Set<string>(), intel_fact: new Set<string>(),
  };
  for (const h of hits) need[h.kind as keyof typeof need]?.add(h.record_id);

  if (need.claim.size) {
    const rows = await q<{ code: string; statement: string; test: string | null; is_frame: boolean }>(
      `select code, statement, test, is_frame from claims where code = any($1::text[])`,
      [[...need.claim]]
    );
    for (const r of rows) {
      push(`claim:${r.code}`, lines(
        `[claim ${r.code}]${r.is_frame ? ' (frame)' : ''} ${clip(r.statement)}`,
        r.test && `  Falsifying test: ${clip(r.test)}`,
      ));
    }
  }
  if (need.bridge.size) {
    const rows = await q<{ code: string; statement: string; test: string | null; domain_from: string; domain_to: string }>(
      `select code, statement, test, domain_from, domain_to from bridge_claims where code = any($1::text[])`,
      [[...need.bridge]]
    );
    for (const r of rows) {
      push(`bridge:${r.code}`, lines(
        `[bridge ${r.code}] ${clip(r.statement)} (${r.domain_from} -> ${r.domain_to})`,
        r.test && `  Falsifying test: ${clip(r.test)}`,
      ));
    }
  }
  if (need.stance.size) {
    const rows = await q<{ code: string; title: string; summary: string | null; q_slug: string }>(
      `select s.code, s.title, s.summary, qn.slug as q_slug
         from stances s join questions qn on qn.id = s.question_id
        where s.code = any($1::text[])`,
      [[...need.stance]]
    );
    for (const r of rows) {
      push(`stance:${r.code}`, lines(
        `[stance ${r.code}] ${r.title} (under Q ${r.q_slug})`,
        r.summary && `  ${clip(r.summary)}`,
      ));
    }
  }
  if (need.concept.size) {
    const rows = await q<{ slug: string; name: string; short_definition: string; status: string }>(
      `select slug, name, short_definition, status from concepts where slug = any($1::text[])`,
      [[...need.concept]]
    );
    for (const r of rows) push(`concept:${r.slug}`, `[concept ${r.slug}] ${r.name} (${r.status}): ${clip(r.short_definition)}`);
  }
  if (need.thread.size) {
    const rows = await q<{ slug: string; title: string; question: string; synthesis: string | null; status: string }>(
      `select slug, title, question, synthesis, status::text as status
         from research_threads where slug = any($1::text[])`,
      [[...need.thread]]
    );
    for (const r of rows) {
      push(`thread:${r.slug}`, lines(
        `[thread ${r.slug}]${r.status !== 'open' ? ` (${r.status})` : ''} ${r.title}: ${clip(r.question, 200)}`,
        r.synthesis && `  Synthesis: ${clip(r.synthesis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 400)}`,
      ));
    }
  }
  if (need.signal.size) {
    const rows = await q<{ id: string; title: string; summary: string | null; claim_touches: string[]; is_published: boolean }>(
      `select id, title, summary, claim_touches, is_published from signals where id = any($1::uuid[])`,
      [[...need.signal]]
    );
    for (const r of rows) {
      const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
      push(`sig:${r.id}`, `[signal ${tagFor(r.id)}] "${r.title}"${r.is_published ? '' : ' (draft)'} ${clip(r.summary, 300)}${touches}`);
    }
  }
  if (need.paper.size) {
    const rows = await q<{ id: string; title: string; arxiv_id: string | null; published_at: string | null; headline: string | null; summary: string | null; claim_touches: string[] }>(
      `select id::text as id, title, arxiv_id, to_char(published_at, 'YYYY-MM-DD') as published_at,
              extraction->>'headline_claim' as headline, triage_summary as summary, claim_touches
         from papers where id = any($1::uuid[])`,
      [[...need.paper]]
    );
    for (const r of rows) {
      const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
      push(`paper:${r.id}`,
        `[paper ${ptagFor(r.id)}] "${clip(r.title, 150)}"${r.arxiv_id ? ` (arXiv ${r.arxiv_id}${r.published_at ? `, ${r.published_at}` : ''})` : ''}: ${clip(r.headline ?? r.summary, 300)}${touches}`);
    }
  }
  // Candidate hits key by signal_candidates.id, but the block they materialize
  // shares the article-excerpt leg's key (the signal's id) — map candidate id
  // -> block key here so the fusion order can find it below.
  const candKeyByRecordId = new Map<string, string>();
  if (need.candidate.size) {
    const rows = await q<{ id: string; sig_id: string; sig_title: string; raw_content: string | null }>(
      `select sc.id, g.id as sig_id, g.title as sig_title, sc.raw_content
         from signal_candidates sc join signals g on g.id = sc.signal_id and g.is_published = true
        where sc.id = any($1::uuid[])`,
      [[...need.candidate]]
    );
    for (const r of rows) {
      const key = `art:sig:${r.sig_id}`;
      candKeyByRecordId.set(r.id, key);
      push(key, `Article excerpt behind [signal ${tagFor(r.sig_id)}] "${r.sig_title}": ${clip(r.raw_content, 400)}`);
    }
  }
  if (need.scan_item.size) {
    const rows = await q<{ id: string; headline: string | null; summary: string | null; source_domain: string | null; published_date: string | null }>(
      `select id::text as id, headline, summary, source_domain, to_char(published_date, 'YYYY-MM-DD') as published_date
         from scan_items where id = any($1::uuid[])`,
      [[...need.scan_item]]
    );
    for (const r of rows) {
      const anchor = r.source_domain ? ` (${r.source_domain}${r.published_date ? `, ${r.published_date}` : ''})` : '';
      push(`item:scan:${r.id}`, `[item ${itemTagFor(`scan:${r.id}`)}] "${clip(r.headline ?? 'Scan item', 150)}"${anchor}: ${clip(r.summary, 300)}`);
    }
  }
  if (need.intel_item.size) {
    const rows = await q<{ id: string; headline: string | null; summary: string | null; source_domain: string | null; company_slug: string | null; published_date: string | null }>(
      `select id::text as id, headline, summary, source_domain, company_slug, to_char(published_date, 'YYYY-MM-DD') as published_date
         from intel_items where id = any($1::uuid[])`,
      [[...need.intel_item]]
    );
    for (const r of rows) {
      const bits = [r.company_slug, r.source_domain, r.published_date].filter(Boolean).join(' · ');
      push(`item:intel:${r.id}`, `[item ${itemTagFor(`intel:${r.id}`)}] "${clip(r.headline ?? 'Intel item', 150)}"${bits ? ` (${bits})` : ''}: ${clip(r.summary, 300)}`);
    }
  }
  if (need.intel_fact.size) {
    const rows = await q<{ id: string; fact: string; value_text: string | null; dimension: string; company_slug: string; as_of: string | null }>(
      `select id::text as id, fact, value_text, dimension, company_slug, to_char(as_of, 'YYYY-MM-DD') as as_of
         from intel_facts where id = any($1::uuid[])`,
      [[...need.intel_fact]]
    );
    for (const r of rows) {
      push(`fact:${r.id}`,
        `[fact ${factTagFor(r.id)}] ${r.company_slug} · ${r.dimension}: ${clip(r.fact, 300)}${r.value_text ? ` (${clip(r.value_text, 80)})` : ''}${r.as_of ? ` as of ${r.as_of}` : ''}`);
    }
  }

  const order: string[] = [];
  for (const h of hits) {
    switch (h.kind) {
      case 'claim': order.push(`claim:${h.record_id}`); break;
      case 'bridge': order.push(`bridge:${h.record_id}`); break;
      case 'stance': order.push(`stance:${h.record_id}`); break;
      case 'concept': order.push(`concept:${h.record_id}`); break;
      case 'thread': order.push(`thread:${h.record_id}`); break;
      case 'signal': order.push(`sig:${h.record_id}`); break;
      case 'paper': order.push(`paper:${h.record_id}`); break;
      case 'candidate': { const k = candKeyByRecordId.get(h.record_id); if (k) order.push(k); break; }
      case 'scan_item': order.push(`item:scan:${h.record_id}`); break;
      case 'intel_item': order.push(`item:intel:${h.record_id}`); break;
      case 'intel_fact': order.push(`fact:${h.record_id}`); break;
    }
  }
  return order;
}

// ---------------------------------------------------------------- FTS helpers
// websearch_to_tsquery handles bare user phrases gracefully (returns an empty
// query, matching nothing, when there are no searchable terms).
async function ftsClaims(query: string, push: (k: string, t: string, r?: number) => void): Promise<string[]> {
  const rows = await q<{ code: string; statement: string; test: string | null; is_frame: boolean; rank: number }>(
    `select code, statement, test, is_frame, ts_rank(search_tsv, ${ORQ}) as rank from claims
      where code is not null and search_tsv @@ ${ORQ}
      order by rank desc limit 8`,
    [query]
  );
  for (const r of rows) {
    push(`claim:${r.code}`, lines(
      `[claim ${r.code}]${r.is_frame ? ' (frame)' : ''} ${clip(r.statement)}`,
      r.test && `  Falsifying test: ${clip(r.test)}`,
    ), r.rank);
  }
  return rows.map((r) => r.code);
}

async function ftsBridges(query: string, push: (k: string, t: string, r?: number) => void): Promise<string[]> {
  const rows = await q<{ code: string; statement: string; test: string | null; domain_from: string; domain_to: string; rank: number }>(
    `select code, statement, test, domain_from, domain_to, ts_rank(search_tsv, ${ORQ}) as rank from bridge_claims
      where code is not null and search_tsv @@ ${ORQ}
      order by rank desc limit 4`,
    [query]
  );
  for (const r of rows) {
    push(`bridge:${r.code}`, lines(
      `[bridge ${r.code}] ${clip(r.statement)} (${r.domain_from} -> ${r.domain_to})`,
      r.test && `  Falsifying test: ${clip(r.test)}`,
    ), r.rank);
  }
  return rows.map((r) => r.code);
}

async function ftsStances(query: string, push: (k: string, t: string, r?: number) => void) {
  const rows = await q<{ code: string; title: string; summary: string | null; test: string; q_slug: string; rank: number }>(
    `select s.code, s.title, s.summary, s.test, qn.slug as q_slug, ts_rank(s.search_tsv, ${ORQ}) as rank
       from stances s join questions qn on qn.id = s.question_id
      where s.code is not null and s.search_tsv @@ ${ORQ}
      order by rank desc limit 6`,
    [query]
  );
  for (const r of rows) {
    push(`stance:${r.code}`, lines(
      `[stance ${r.code}] ${r.title} (under Q ${r.q_slug})`,
      r.summary && `  ${clip(r.summary)}`,
    ), r.rank);
  }
}

async function ftsConcepts(query: string, push: (k: string, t: string, r?: number) => void) {
  const rows = await q<{ slug: string; name: string; short_definition: string; status: string; rank: number }>(
    `select slug, name, short_definition, status, ts_rank(search_tsv, ${ORQ}) as rank from concepts
      where search_tsv @@ ${ORQ}
      order by rank desc limit 6`,
    [query]
  );
  for (const r of rows) {
    push(`concept:${r.slug}`, `[concept ${r.slug}] ${r.name} (${r.status}): ${clip(r.short_definition)}`, r.rank);
  }
}

async function ftsSignals(query: string, push: (k: string, t: string, r?: number) => void, tagFor: (id: string) => string, mode: AskMode) {
  const rows = await q<{ id: string; title: string; summary: string | null; claim_touches: string[]; is_published: boolean; rank: number }>(
    `select id, title, summary, claim_touches, is_published, ts_rank(search_tsv, ${ORQ}, ${RANK_NORM}) as rank from signals
      where search_tsv @@ ${ORQ}
        ${mode === 'portal' ? 'and is_published = true' : ''}
      order by rank desc limit 8`,
    [query]
  );
  for (const r of rows) {
    const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
    push(`sig:${r.id}`,
      `[signal ${tagFor(r.id)}] "${r.title}"${r.is_published ? '' : ' (draft)'} ${clip(r.summary, 300)}${touches}`, r.rank);
  }
}

async function ftsThreads(query: string, push: (k: string, t: string, r?: number) => void) {
  const rows = await q<{ slug: string; title: string; question: string; synthesis: string | null; status: string; rank: number }>(
    `select slug, title, question, synthesis, status::text as status, ts_rank(search_tsv, ${ORQ}) as rank from research_threads
      where search_tsv @@ ${ORQ}
      order by rank desc limit 3`,
    [query]
  );
  for (const r of rows) {
    push(`thread:${r.slug}`, lines(
      `[thread ${r.slug}]${r.status !== 'open' ? ` (${r.status})` : ''} ${r.title}: ${clip(r.question, 200)}`,
      r.synthesis && `  Synthesis: ${clip(r.synthesis.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 400)}`,
    ), r.rank);
  }
}

// The research corpus: kept papers (never rejected/pending-triage rows), the
// reviewed shelf ranked first. Indexed text is public editorial only; the
// snippet leads with the finding's headline when one exists.
async function ftsPapers(query: string, push: (k: string, t: string, r?: number) => void, ptagFor: (id: string) => string) {
  const rows = await q<{ id: string; title: string; arxiv_id: string | null; published_at: string | null; headline: string | null; summary: string | null; claim_touches: string[]; reviewed: boolean; rank: number }>(
    `select id::text as id, title, arxiv_id,
            to_char(published_at, 'YYYY-MM-DD') as published_at,
            extraction->>'headline_claim' as headline, triage_summary as summary,
            claim_touches, review_status in ('tracked', 'noted') as reviewed,
            ts_rank(search_tsv, ${ORQ}, ${RANK_NORM}) as rank
       from papers
      where triage_status = 'kept' and review_status <> 'dismissed'
        and search_tsv @@ ${ORQ}
      order by (review_status in ('tracked', 'noted')) desc, rank desc
      limit 4`,
    [query]
  );
  for (const r of rows) {
    const touches = r.claim_touches.length ? ` (touches ${r.claim_touches.join(', ')})` : '';
    push(`paper:${r.id}`,
      `[paper ${ptagFor(r.id)}] "${clip(r.title, 150)}"${r.arxiv_id ? ` (arXiv ${r.arxiv_id}${r.published_at ? `, ${r.published_at}` : ''})` : ''}: ${clip(r.headline ?? r.summary, 300)}${touches}`, r.rank);
  }
}

async function ftsEvidence(query: string, push: (k: string, t: string, r?: number) => void, mode: AskMode) {
  const rows = await q<{ target_type: string; target_code: string | null; direction: string; excerpt: string | null; note: string | null; rank: number }>(
    `select e.target_type, e.direction, e.excerpt,
            ${mode === 'admin' ? 'e.note' : 'null::text as note'},
            coalesce(c.code, b.code) as target_code,
            ts_rank(e.search_tsv, ${ORQ}, ${RANK_NORM}) as rank
       from evidence e
       left join claims c on e.target_type = 'claim' and c.id = e.target_id
       left join bridge_claims b on e.target_type = 'bridge_claim' and b.id = e.target_id
      where e.search_tsv @@ ${ORQ}
        and coalesce(c.code, b.code) is not null
        ${mode === 'portal' ? `and e.excerpt is not null
        and (e.signal_id is null or exists (select 1 from signals g where g.id = e.signal_id and g.is_published))` : ''}
      order by rank desc limit 8`,
    [query]
  );
  for (const e of rows) {
    const token = e.target_type === 'bridge_claim' ? `[bridge ${e.target_code}]` : `[claim ${e.target_code}]`;
    push(`ev:${e.target_code}:${clip(e.excerpt ?? e.note, 40)}`,
      `Evidence for ${token} (${e.direction}): ${clip(e.excerpt ?? e.note, 300)}`, e.rank);
  }
}

// The article-excerpt leg over the 0029 tsvectors: curated source text and the
// pipeline's cached page text, surfaced ONLY through a published signal or a
// publicly cited source (guest-safe in both modes). ts_headline generates two
// short fragments; full articles never enter the prompt.
async function ftsArticles(query: string, push: (k: string, t: string, r?: number) => void, tagFor: (id: string) => string) {
  const HL_OPTS = `'MaxFragments=2, MaxWords=30, MinWords=8'`;
  const srcRows = await q<{ id: string; title: string; outlet: string | null; excerpt: string; sig_id: string | null; sig_title: string | null; rank: number }>(
    `select s.id, s.title, s.outlet,
            ts_headline('english', left(coalesce(s.raw_text, ''), 200000), ${ORQ}, ${HL_OPTS}) as excerpt,
            sig.id as sig_id, sig.title as sig_title,
            ts_rank(s.search_tsv, ${ORQ}, ${RANK_NORM}) as rank
       from sources s
       left join lateral (
         select g.id, g.title from signals g
          where g.source_id = s.id and g.is_published = true
          order by g.published_at desc nulls last, g.id limit 1
       ) sig on true
      where s.search_tsv @@ ${ORQ} and s.raw_text is not null
        and (sig.id is not null or exists (select 1 from evidence e where e.source_id = s.id))
      order by rank desc, s.id limit 3`,
    [query]
  );
  for (const r of srcRows) {
    const anchor = r.sig_id ? ` [signal ${tagFor(r.sig_id)}]` : '';
    push(`art:src:${r.id}`,
      `Article excerpt from "${r.title}"${r.outlet ? ` (${r.outlet})` : ''}${anchor}: ${clip(r.excerpt, 400)}`, r.rank);
  }
  const candRows = await q<{ sig_id: string; sig_title: string; excerpt: string; rank: number }>(
    `select g.id as sig_id, g.title as sig_title,
            ts_headline('english', left(coalesce(sc.raw_content, ''), 200000), ${ORQ}, ${HL_OPTS}) as excerpt,
            ts_rank(sc.search_tsv, ${ORQ}, ${RANK_NORM}) as rank
       from signal_candidates sc
       join signals g on g.id = sc.signal_id and g.is_published = true
      where sc.search_tsv @@ ${ORQ}
      order by rank desc, sc.id limit 3`,
    [query]
  );
  for (const r of candRows) {
    push(`art:sig:${r.sig_id}`,
      `Article excerpt behind [signal ${tagFor(r.sig_id)}] "${r.sig_title}": ${clip(r.excerpt, 400)}`, r.rank);
  }
}

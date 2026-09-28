// Per-kind text assemblers for the embedding pipeline, and the guest-safety
// predicates that decide which ROWS ever get embedded. Zero imports (the
// pack-core injected-Q discipline: lib/pack-shared.ts, lib/ask/search.ts) so
// this module loads directly under plain Node type stripping and the same
// functions serve both the app (lib/embed/index.ts, passing lib/db's q) and
// scripts/backfill-embeddings.mjs (passing a raw pg client wrapper) with no
// SQL copy-pasted between the two — keep any predicate change here, in ONE
// place, rather than hand-mirrored the way the older backfill scripts had to.
//
// Guest-safety mirrors the equivalent FTS leg / dataset builder exactly:
//   - signal: published only (retrieve.ts's ftsSignals, portal mode).
//   - candidate: raw_content present AND linked to a published signal
//     (retrieve.ts's ftsArticles candidate leg).
//   - scan_item / intel_item / intel_fact: any status. These are ONLY ever
//     surfaced to portal/admin Ask (the datasets are key-gated; guests never
//     reach buildAskContext with a mode that would expose them) so nothing
//     here needs an is_published-style gate of its own.
//   - paper: kept, not dismissed (retrieve.ts's ftsPapers).
//   - report (2026-09-27): the Atlas's published editorial reports (Daily
//     Edition within the last EDITION_WINDOW_DAYS, research roundups, Savant),
//     one record PER SECTION ('<uuid>:<section>', lib/embed/report-sections.ts).
//     Savant's peer watch section is embedded too; retrieval serves it to
//     keyholders and the admin only, and the public peek refuses it.
//   - history_item (migration 0076): the "since ChatGPT" backfill of dated
//     news items, kept-triage only. Keyholder/admin only, same reasoning as
//     scan_item/intel_item above (Ask never reaches these for a guest).
//   - claim / bridge / stance / concept / thread: no personal-layer columns
//     are ever selected (statement/test/definition/synthesis only, never
//     domain_note, confidence, or review notes).

export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type EmbedKind =
  | 'signal' | 'candidate' | 'scan_item' | 'intel_item' | 'intel_fact'
  | 'paper' | 'claim' | 'bridge' | 'stance' | 'concept' | 'thread' | 'report' | 'history_item';

export const EMBED_KINDS: EmbedKind[] = [
  'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
  'paper', 'claim', 'bridge', 'stance', 'concept', 'thread', 'report', 'history_item',
];

export interface EmbeddableRecord {
  record_id: string;
  title: string;
  text: string;
}

import { reportSections, reportPrefix, EDITION_WINDOW_DAYS } from './report-sections';

const j = (...xs: (string | null | undefined)[]): string => xs.filter((x) => !!x && x.trim()).join('\n\n');
const stripHtml = (s: string | null | undefined): string | null =>
  s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;

// Each kind's "what counts as embeddable" predicate, written ONCE and used by
// both the text fetchers below and countMissingEmbeddings' id-only anti-join.
// `from` carries its own where clause so a fetcher can append `and ...`;
// `id` is the record_id expression (a text value). Empty text is excluded
// with `<> ''`, which Postgres answers from the stored length without
// detoasting the article (a whitespace regex read ~50 MB of scan text and cost
// 10x; there were zero whitespace-only rows on 2026-09-28). The fetchers keep
// their JS trim, so a whitespace-only row would still never embed.
// Reports are absent: their record ids are per-section, computed in code by
// reportSections(), so they are counted on the fetch path (38 rows).
const NONBLANK = (col: string) => `${col} is not null and ${col} <> ''`;
export const EMBED_SOURCES: Record<Exclude<EmbedKind, 'report'>, { from: string; id: string }> = {
  signal: { from: `from signals where is_published = true`, id: 'id::text' },
  candidate: {
    from: `from signal_candidates sc join signals g on g.id = sc.signal_id and g.is_published = true where ${NONBLANK('sc.raw_content')}`,
    id: 'sc.id::text',
  },
  scan_item: { from: `from scan_items where ${NONBLANK('raw_content')}`, id: 'id::text' },
  intel_item: { from: `from intel_items where ${NONBLANK('raw_content')}`, id: 'id::text' },
  intel_fact: { from: `from intel_facts where true`, id: 'id::text' },
  paper: { from: `from papers where triage_status = 'kept' and review_status <> 'dismissed'`, id: 'id::text' },
  claim: { from: `from claims where code is not null and is_frame = false`, id: 'code' },
  bridge: { from: `from bridge_claims where code is not null`, id: 'code' },
  stance: { from: `from stances where code is not null`, id: 'code' },
  concept: { from: `from concepts where true`, id: 'slug' },
  thread: { from: `from research_threads where true`, id: 'slug' },
  history_item: { from: `from history_items where triage = 'kept'`, id: 'id::text' },
};

export async function embeddableSignals(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{
    id: string; title: string; summary: string | null;
    what_happened: string | null; why_it_matters: string | null; whats_contested: string | null;
    counterpoint: string | null;
  }>(
    `select id::text as id, title, summary,
            brief->>'what_happened' as what_happened,
            brief->>'why_it_matters' as why_it_matters,
            brief->>'whats_contested' as whats_contested,
            counterpoint->>'the_other_read' as counterpoint
       ${EMBED_SOURCES.signal.from}
       ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({
    record_id: r.id,
    title: r.title,
    text: j(r.summary, r.what_happened, r.why_it_matters, r.whats_contested, r.counterpoint),
  }));
}

export async function embeddableCandidates(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; title: string; raw_content: string | null }>(
    `select sc.id::text as id, g.title, sc.raw_content
       ${EMBED_SOURCES.candidate.from}
      ${ids ? 'and sc.id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.title, text: r.raw_content ?? '' }));
}

export async function embeddableScanItems(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; headline: string | null; summary: string | null; raw_content: string | null }>(
    `select id::text as id, headline, summary, raw_content ${EMBED_SOURCES.scan_item.from}
      ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.headline ?? 'Scan item', text: j(r.headline, r.summary, r.raw_content) }));
}

export async function embeddableIntelItems(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; headline: string | null; summary: string | null; raw_content: string | null }>(
    `select id::text as id, headline, summary, raw_content ${EMBED_SOURCES.intel_item.from}
      ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.headline ?? 'Intel item', text: j(r.headline, r.summary, r.raw_content) }));
}

export async function embeddableIntelFacts(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; fact: string; value_text: string | null; dimension: string; company_slug: string }>(
    `select id::text as id, fact, value_text, dimension, company_slug ${EMBED_SOURCES.intel_fact.from}
      ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({
    record_id: r.id,
    title: `${r.company_slug}: ${r.dimension}`,
    text: j(r.fact, r.value_text, `dimension: ${r.dimension}`, `company: ${r.company_slug}`),
  }));
}

export async function embeddablePapers(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; title: string; abstract: string | null; extraction: Record<string, unknown> | null }>(
    `select id::text as id, title, abstract, extraction
       ${EMBED_SOURCES.paper.from}
       ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => {
    const ex = r.extraction ?? {};
    const field = (k: string): string | null => (typeof ex[k] === 'string' ? (ex[k] as string) : null);
    return {
      record_id: r.id,
      title: r.title,
      text: j(
        r.abstract,
        field('headline_claim'), field('the_test'), field('effect_size'),
        field('limitations'), field('counterpoint'), field('econ_implication')
      ),
    };
  });
}

export async function embeddableClaims(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; statement: string; test: string | null }>(
    `select code, statement, test ${EMBED_SOURCES.claim.from}
     ${ids ? 'and code = any($1::text[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
}

export async function embeddableBridges(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; statement: string; test: string | null }>(
    `select code, statement, test ${EMBED_SOURCES.bridge.from}
     ${ids ? 'and code = any($1::text[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
}

export async function embeddableStances(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; title: string; summary: string | null; test: string | null }>(
    `select code, title, summary, test ${EMBED_SOURCES.stance.from}
     ${ids ? 'and code = any($1::text[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({ record_id: r.code, title: r.title, text: j(r.title, r.summary, r.test) }));
}

export async function embeddableConcepts(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ slug: string; name: string; short_definition: string; explanation: string | null }>(
    `select slug, name, short_definition, explanation ${EMBED_SOURCES.concept.from}
     ${ids ? 'and slug = any($1::text[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({ record_id: r.slug, title: r.name, text: j(r.short_definition, r.explanation) }));
}

export async function embeddableThreads(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ slug: string; title: string; question: string; synthesis: string | null }>(
    `select slug, title, question, synthesis ${EMBED_SOURCES.thread.from}
     ${ids ? 'and slug = any($1::text[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({ record_id: r.slug, title: r.title, text: j(r.question, stripHtml(r.synthesis)) }));
}

// ids are REPORT uuids (what a writer hands embedLater); the records that
// come back are its sections.
export async function embeddableReports(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; kind: string; scope_to: string | null; title: string; narrative: unknown }>(
    `select id::text as id, kind::text as kind, scope_to::text as scope_to, title, narrative
       from generated_reports
      where is_published
        and (kind = 'savant' or kind = 'roundup'
             or (kind = 'edition' and scope_to >= current_date - ${EDITION_WINDOW_DAYS}))
        ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.flatMap((r) => reportSections(r).map((s) => ({
    record_id: `${r.id}:${s.key}`,
    title: reportPrefix(r.kind, r.scope_to, s.label),
    text: s.text,
  })));
}

// Kept-triage only (rejected/duplicate/pending rows never embed); text is the
// exact format lib/history/core.ts's own record shape gives us, since the
// backfill writes no full text: title, then date + lens, then the Tavily
// snippet.
export async function embeddableHistoryItems(q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; title: string; published_date: string; lens: string; snippet: string | null }>(
    `select id::text as id, title, to_char(published_date, 'YYYY-MM-DD') as published_date,
            lens::text as lens, snippet
       ${EMBED_SOURCES.history_item.from}
       ${ids ? 'and id = any($1::uuid[])' : ''}`,
    ids ? [ids] : []
  );
  return rows.map((r) => ({
    record_id: r.id,
    title: r.title,
    text: `${r.title}\n${r.published_date} · ${r.lens}\n${r.snippet ?? ''}`,
  }));
}

export async function getEmbeddable(kind: EmbedKind, q: Q, ids?: string[]): Promise<EmbeddableRecord[]> {
  switch (kind) {
    case 'signal': return embeddableSignals(q, ids);
    case 'candidate': return embeddableCandidates(q, ids);
    case 'scan_item': return embeddableScanItems(q, ids);
    case 'intel_item': return embeddableIntelItems(q, ids);
    case 'intel_fact': return embeddableIntelFacts(q, ids);
    case 'paper': return embeddablePapers(q, ids);
    case 'claim': return embeddableClaims(q, ids);
    case 'bridge': return embeddableBridges(q, ids);
    case 'stance': return embeddableStances(q, ids);
    case 'concept': return embeddableConcepts(q, ids);
    case 'thread': return embeddableThreads(q, ids);
    case 'report': return embeddableReports(q, ids);
    case 'history_item': return embeddableHistoryItems(q, ids);
  }
}

// Per-kind count of records satisfying the kind's predicate (EMBED_SOURCES)
// with no embeddings row for the given model yet: the embeddings.missing agent
// check, its backfill remedy, and the /ops Background widget. An id-only
// anti-join per kind that never reads a record's text. (Until 2026-09-28 this
// fetched every embeddable record's FULL text to diff ids in JS: about 93 MB
// per call, 6 to 7 seconds, on every /ops load and every hourly agent tick.)
// Reports keep the fetch path because their record ids are per-section.
export async function countMissingEmbeddings(q: Q, model: string): Promise<Record<EmbedKind, number>> {
  const out = {} as Record<EmbedKind, number>;
  // One round trip for every SQL-countable kind (13 sequential queries cost
  // ~0.7 s on the one-connection production pool), plus the report path.
  const kinds = Object.keys(EMBED_SOURCES) as (keyof typeof EMBED_SOURCES)[];
  const union = kinds.map((kind) => {
    const src = EMBED_SOURCES[kind];
    return `select '${kind}' as kind, count(*)::int as n from (select ${src.id} as record_id ${src.from}) s
             where not exists (select 1 from embeddings e where e.kind = '${kind}' and e.model = $1 and e.record_id = s.record_id)`;
  }).join('\n union all\n');
  const [rows, reportIds] = await Promise.all([
    q<{ kind: EmbedKind; n: number }>(union, [model]),
    embeddableReports(q).then((rs) => rs.map((r) => r.record_id)),
  ]);
  for (const r of rows) out[r.kind] = r.n;
  if (reportIds.length) {
    const have = await q<{ n: number }>(
      `select count(distinct record_id)::int as n from embeddings where kind = 'report' and model = $1 and record_id = any($2::text[])`,
      [model, reportIds]
    );
    out.report = reportIds.length - (have[0]?.n ?? 0);
  } else {
    out.report = 0;
  }
  for (const k of EMBED_KINDS) out[k] ??= 0;
  return out;
}

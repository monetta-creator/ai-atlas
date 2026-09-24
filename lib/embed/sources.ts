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
//   - claim / bridge / stance / concept / thread: no personal-layer columns
//     are ever selected (statement/test/definition/synthesis only, never
//     domain_note, confidence, or review notes).

export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export type EmbedKind =
  | 'signal' | 'candidate' | 'scan_item' | 'intel_item' | 'intel_fact'
  | 'paper' | 'claim' | 'bridge' | 'stance' | 'concept' | 'thread';

export const EMBED_KINDS: EmbedKind[] = [
  'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
  'paper', 'claim', 'bridge', 'stance', 'concept', 'thread',
];

export interface EmbeddableRecord {
  record_id: string;
  title: string;
  text: string;
}

const j = (...xs: (string | null | undefined)[]): string => xs.filter((x) => !!x && x.trim()).join('\n\n');
const stripHtml = (s: string | null | undefined): string | null =>
  s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;

export async function embeddableSignals(q: Q): Promise<EmbeddableRecord[]> {
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
       from signals where is_published = true`
  );
  return rows.map((r) => ({
    record_id: r.id,
    title: r.title,
    text: j(r.summary, r.what_happened, r.why_it_matters, r.whats_contested, r.counterpoint),
  }));
}

export async function embeddableCandidates(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; title: string; raw_content: string | null }>(
    `select sc.id::text as id, g.title, sc.raw_content
       from signal_candidates sc
       join signals g on g.id = sc.signal_id and g.is_published = true
      where sc.raw_content is not null`
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.title, text: r.raw_content ?? '' }));
}

export async function embeddableScanItems(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; headline: string | null; summary: string | null; raw_content: string | null }>(
    `select id::text as id, headline, summary, raw_content from scan_items where raw_content is not null`
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.headline ?? 'Scan item', text: j(r.headline, r.summary, r.raw_content) }));
}

export async function embeddableIntelItems(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; headline: string | null; summary: string | null; raw_content: string | null }>(
    `select id::text as id, headline, summary, raw_content from intel_items where raw_content is not null`
  );
  return rows
    .filter((r) => (r.raw_content ?? '').trim())
    .map((r) => ({ record_id: r.id, title: r.headline ?? 'Intel item', text: j(r.headline, r.summary, r.raw_content) }));
}

export async function embeddableIntelFacts(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; fact: string; value_text: string | null; dimension: string; company_slug: string }>(
    `select id::text as id, fact, value_text, dimension, company_slug from intel_facts`
  );
  return rows.map((r) => ({
    record_id: r.id,
    title: `${r.company_slug}: ${r.dimension}`,
    text: j(r.fact, r.value_text, `dimension: ${r.dimension}`, `company: ${r.company_slug}`),
  }));
}

export async function embeddablePapers(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ id: string; title: string; abstract: string | null; extraction: Record<string, unknown> | null }>(
    `select id::text as id, title, abstract, extraction
       from papers where triage_status = 'kept' and review_status <> 'dismissed'`
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

export async function embeddableClaims(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; statement: string; test: string | null }>(
    `select code, statement, test from claims where code is not null and is_frame = false`
  );
  return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
}

export async function embeddableBridges(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; statement: string; test: string | null }>(
    `select code, statement, test from bridge_claims where code is not null`
  );
  return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
}

export async function embeddableStances(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ code: string; title: string; summary: string | null; test: string | null }>(
    `select code, title, summary, test from stances where code is not null`
  );
  return rows.map((r) => ({ record_id: r.code, title: r.title, text: j(r.title, r.summary, r.test) }));
}

export async function embeddableConcepts(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ slug: string; name: string; short_definition: string; explanation: string | null }>(
    `select slug, name, short_definition, explanation from concepts`
  );
  return rows.map((r) => ({ record_id: r.slug, title: r.name, text: j(r.short_definition, r.explanation) }));
}

export async function embeddableThreads(q: Q): Promise<EmbeddableRecord[]> {
  const rows = await q<{ slug: string; title: string; question: string; synthesis: string | null }>(
    `select slug, title, question, synthesis from research_threads`
  );
  return rows.map((r) => ({ record_id: r.slug, title: r.title, text: j(r.question, stripHtml(r.synthesis)) }));
}

export async function getEmbeddable(kind: EmbedKind, q: Q): Promise<EmbeddableRecord[]> {
  switch (kind) {
    case 'signal': return embeddableSignals(q);
    case 'candidate': return embeddableCandidates(q);
    case 'scan_item': return embeddableScanItems(q);
    case 'intel_item': return embeddableIntelItems(q);
    case 'intel_fact': return embeddableIntelFacts(q);
    case 'paper': return embeddablePapers(q);
    case 'claim': return embeddableClaims(q);
    case 'bridge': return embeddableBridges(q);
    case 'stance': return embeddableStances(q);
    case 'concept': return embeddableConcepts(q);
    case 'thread': return embeddableThreads(q);
  }
}

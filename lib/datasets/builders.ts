import type { DatasetOpts, DatasetRow, Q } from './core';
import { isPositiveInt } from './core.ts';
// Explicit .ts extension: this chain is loaded by plain Node in
// scripts/test-datasets.mjs (type stripping), which resolves no extensionless
// specifiers. The bundler resolves it identically.
import { domainOfUrl, normalizeUrl } from '../pack-shared.ts';

// Dataset builders. See core.ts for the contract: injected Q, deterministic
// ordering, guest-safe by construction (no personal-layer column ever appears in
// a SELECT list here; scripts/test-datasets.mjs asserts it against the output).
//
// Signals visibility floor: every builder that reads signals carries
// `is_published = true`, the same guest floor as the public feed (lib/data.ts
// getSignalsPage). Evidence rows are only ever surfaced through a published
// signal or a curated source, and sources appear only when publicly referenced
// by evidence or a published signal.

// ---------------------------------------------------------------------------

export async function buildSignals(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  const params: unknown[] = [];
  let lensClause = '';
  if (opts.lens) {
    params.push(opts.lens);
    lensClause = `and $${params.length} = any(s.lenses::text[])`;
  }
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  const rows = await q<DatasetRow & { source_url: string | null }>(
    `select s.id::text as signal_id, s.title, s.summary,
            s.significance::text as significance,
            array_to_string(s.lenses::text[], '; ') as lenses,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.origin::text as origin,
            array_to_string(s.claim_touches, '; ') as claim_touches,
            src.title as source_title, src.url as source_url,
            s.brief->>'what_happened'   as brief_what_happened,
            s.brief->>'why_it_matters'  as brief_why_it_matters,
            s.brief->>'whats_contested' as brief_whats_contested,
            s.counterpoint->>'the_other_read' as counterpoint
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = true ${lensClause}
      order by s.published_at desc nulls last, s.id${limitClause}`,
    params
  );
  return rows.map((r) => ({ ...r, source_domain: domainOfUrl(r.source_url) }));
}

// ---------------------------------------------------------------------------

interface LensTagRow { target_type: string; target_id: string; lens_tags: string }

export async function buildArgumentNodes(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  const [questions, stances, claims, bridges, lensTags] = await Promise.all([
    q<DatasetRow>(
      `select slug as code, title, summary, primary_lens::text as primary_lens, id::text as _id
         from questions order by sort_order, id`
    ),
    q<DatasetRow>(
      `select s.code, s.title, s.summary, s.test, s.holder, qq.slug as question, s.id::text as _id
         from stances s join questions qq on qq.id = s.question_id
        order by qq.sort_order, s.sort_order, s.id`
    ),
    q<DatasetRow>(
      `select code, statement, test, domain::text as domain,
              case when is_frame then 'yes' else 'no' end as is_frame,
              resolvability::text as resolvability, id::text as _id
         from claims order by code, id`
    ),
    q<DatasetRow>(
      `select code, statement, test, domain_from::text as domain_from,
              domain_to::text as domain_to, resolvability::text as resolvability, id::text as _id
         from bridge_claims order by code, id`
    ),
    q<LensTagRow>(
      `select target_type::text as target_type, target_id::text as target_id,
              string_agg(lens::text, '; ' order by lens) as lens_tags
         from node_lenses group by 1, 2`
    ),
  ]);
  const tags = new Map(lensTags.map((t) => [`${t.target_type}:${t.target_id}`, t.lens_tags]));
  const base = (): DatasetRow => ({
    node_type: null, code: null, statement: null, summary: null, test: null,
    domain: null, domain_from: null, domain_to: null, question: null, holder: null,
    is_frame: null, resolvability: null, lens_tags: null, href: null,
  });
  const out: DatasetRow[] = [];
  for (const r of questions) {
    out.push({
      ...base(), node_type: 'question', code: r.code, statement: r.title,
      summary: r.summary, lens_tags: r.primary_lens, href: `/q/${r.code}`,
    });
  }
  for (const r of stances) {
    out.push({
      ...base(), node_type: 'stance', code: r.code, statement: r.title,
      summary: r.summary, test: r.test, question: r.question, holder: r.holder,
      lens_tags: tags.get(`stance:${r._id}`) ?? null, href: `/q/${r.question}`,
    });
  }
  for (const r of claims) {
    out.push({
      ...base(), node_type: r.is_frame === 'yes' ? 'frame' : 'claim', code: r.code,
      statement: r.statement, test: r.test, domain: r.domain, is_frame: r.is_frame,
      resolvability: r.resolvability, lens_tags: tags.get(`claim:${r._id}`) ?? null,
      href: `/claim/${encodeURIComponent(String(r.code))}`,
    });
  }
  for (const r of bridges) {
    out.push({
      ...base(), node_type: 'bridge_claim', code: r.code, statement: r.statement,
      test: r.test, domain_from: r.domain_from, domain_to: r.domain_to,
      resolvability: r.resolvability, lens_tags: tags.get(`bridge_claim:${r._id}`) ?? null,
      href: `/bridge/${r.code}`,
    });
  }
  return isPositiveInt(opts.limit) ? out.slice(0, opts.limit) : out;
}

// ---------------------------------------------------------------------------

export async function buildArgumentEdges(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // edges carries no FK (polymorphic uuids); dangling rows resolve to null codes
  // and are dropped here, matching how the app tolerates orphans at read time.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select e.from_type::text as from_type,
            coalesce(fs.code, fc.code, fb.code) as from_code,
            e.to_type::text as to_type,
            coalesce(ts.code, tc.code, tb.code) as to_code,
            e.relation::text as relation
       from edges e
       left join stances       fs on e.from_type = 'stance'       and fs.id = e.from_id
       left join claims        fc on e.from_type = 'claim'        and fc.id = e.from_id
       left join bridge_claims fb on e.from_type = 'bridge_claim' and fb.id = e.from_id
       left join stances       ts on e.to_type   = 'stance'       and ts.id = e.to_id
       left join claims        tc on e.to_type   = 'claim'        and tc.id = e.to_id
       left join bridge_claims tb on e.to_type   = 'bridge_claim' and tb.id = e.to_id
      where coalesce(fs.code, fc.code, fb.code) is not null
        and coalesce(ts.code, tc.code, tb.code) is not null
      order by 2, 4, 5${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildEvidenceLedger(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Never selects evidence.note (admin-only) or the source's reliability_prior.
  // The signal guard is belt and braces: syncSignalEvidence removes rows on
  // unpublish, so signal-anchored evidence should already be published-only.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select e.id::text as evidence_id,
            e.target_type::text as target_type,
            coalesce(c.code, b.code) as target_code,
            coalesce(c.statement, b.statement) as target_statement,
            e.direction::text as direction,
            e.weight::text as weight,
            e.excerpt,
            e.lens::text as lens,
            e.signal_id::text as signal_id,
            sig.title as signal_title,
            src.title as source_title,
            src.url as source_url,
            to_char(e.created_at, 'YYYY-MM-DD') as added_on
       from evidence e
       left join claims        c   on e.target_type = 'claim'        and c.id = e.target_id
       left join bridge_claims b   on e.target_type = 'bridge_claim' and b.id = e.target_id
       left join signals       sig on sig.id = e.signal_id
       left join sources       src on src.id = e.source_id
      where coalesce(c.code, b.code) is not null
        and (e.signal_id is null or sig.is_published = true)
      order by e.created_at desc, e.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildSources(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Bibliography of publicly referenced sources only: a source enters when it
  // backs at least one evidence row or one published signal. Admin working rows
  // (unreferenced uploads) stay out. No reliability_prior, no dossier.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  const rows = await q<DatasetRow & { url: string | null }>(
    `select s.id::text as source_id, s.title, s.author, s.outlet, s.url,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.domain_tag::text as domain_tag,
            (select count(*)::int from evidence e where e.source_id = s.id) as evidence_count,
            (select count(*)::int from signals sig
              where sig.source_id = s.id and sig.is_published = true) as published_signal_count,
            case when (s.raw_text is not null and length(s.raw_text) > 0)
                   or exists (select 1 from signals sig2
                               join signal_candidates sc on sc.signal_id = sig2.id
                              where sig2.source_id = s.id and sig2.is_published = true
                                and sc.raw_content is not null)
                 then 'yes' else 'no' end as has_full_text
       from sources s
      where exists (select 1 from evidence e where e.source_id = s.id)
         or exists (select 1 from signals sig where sig.source_id = s.id and sig.is_published = true)
      order by s.published_at desc nulls last, s.id${limitClause}`,
    params
  );
  return rows.map((r) => ({ ...r, source_domain: domainOfUrl(r.url) }));
}

// ---------------------------------------------------------------------------

export async function buildArticlesFullText(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // One row per published signal that has article text. Curated source text wins
  // over the pipeline's cached page text; the lateral picks the newest candidate
  // deterministically when several carry text for the same signal.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select s.id::text as signal_id, s.title as signal_title,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.significance::text as significance,
            array_to_string(s.lenses::text[], '; ') as lenses,
            src.title as source_title, src.outlet, src.url as source_url,
            length(coalesce(src.raw_text, sc.raw_content)) as text_chars,
            coalesce(src.raw_text, sc.raw_content) as full_text
       from signals s
       left join sources src on src.id = s.source_id
       left join lateral (
         select c.raw_content from signal_candidates c
          where c.signal_id = s.id and c.raw_content is not null
          order by c.retrieved_at desc, c.id limit 1
       ) sc on true
      where s.is_published = true
        and coalesce(src.raw_text, sc.raw_content) is not null
      order by s.published_at desc nulls last, s.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildConcepts(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select c.slug, c.name, c.short_definition, c.explanation, c.status::text as status,
            (select string_agg(p.slug, '; ' order by p.slug)
               from concept_edges ce join concepts p on p.id = ce.prerequisite_id
              where ce.concept_id = c.id and ce.status = 'confirmed') as prerequisites,
            (select string_agg(cc.target_code, '; ' order by cc.target_code)
               from concept_claims cc
              where cc.concept_id = c.id and cc.status = 'confirmed') as linked_claims
       from concepts c
      order by c.slug${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildSignalsByClaim(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // The touch matrix in long form: one row per (published signal, touched code).
  // direction comes from the evidence row syncSignalEvidence materialized on
  // publish (at most one per pair, by the 0006 unique partial index); a null
  // direction means the touch predates the sync or cites a frame.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select t.code as claim_code,
            case when b.code is not null then 'bridge_claim' else 'claim' end as claim_type,
            coalesce(c.statement, b.statement) as claim_statement,
            s.id::text as signal_id, s.title as signal_title,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.significance::text as significance,
            array_to_string(s.lenses::text[], '; ') as lenses,
            e.direction::text as direction
       from signals s
      cross join lateral unnest(s.claim_touches) as t(code)
       left join claims        c on c.code = t.code and c.is_frame = false
       left join bridge_claims b on b.code = t.code
       left join evidence e on e.signal_id = s.id
            and ((e.target_type = 'claim' and e.target_id = c.id)
              or (e.target_type = 'bridge_claim' and e.target_id = b.id))
      where s.is_published = true
        and coalesce(c.code, b.code) is not null
      order by t.code, s.published_at desc nulls last, s.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildThesisReports(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Reads the frozen guest-safe pack stats straight off thesis_reports; the
  // statement is the frozen one (theses.statement may have moved on).
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select tr.id::text as report_id,
            tr.statement as thesis_statement,
            array_to_string(t.claim_codes, '; ') as claim_codes,
            to_char(tr.generated_at, 'YYYY-MM-DD') as generated_on,
            (tr.pack->'stats'->>'scanned')::int  as signals_scanned,
            (tr.pack->'stats'->>'matched')::int  as signals_matched,
            (tr.pack->'stats'->'stances'->>'supports')::int    as supporting,
            (tr.pack->'stats'->'stances'->>'contradicts')::int as contradicting,
            (tr.pack->'stats'->'stances'->>'mixed')::int       as mixed,
            (tr.pack->'stats'->'stances'->>'neutral')::int     as neutral,
            (tr.pack->'stats'->'stances'->>'untyped')::int     as untyped,
            case when (tr.pack->'stats'->>'oneSided')::boolean then 'yes' else 'no' end as one_sided,
            case when (tr.pack->'stats'->>'thin')::boolean then 'yes' else 'no' end as thin,
            tr.pack->'stats'->>'firstPublished' as first_matched,
            tr.pack->'stats'->>'lastPublished'  as last_matched,
            '/thesis-report/' || tr.id as report_url
       from thesis_reports tr
       join theses t on t.id = tr.thesis_id
      order by tr.generated_at desc, tr.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildResearchPapers(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // The curated library only (triage kept), never the raw funnel. claim_touches
  // here is ADVISORY: papers never write evidence; the only road into the map is
  // promotion to a signal. Excludes the reviewer's private fields (review_note,
  // rigor_prior) by construction.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select p.arxiv_id, p.title, p.url, p.abstract,
            array_to_string(p.categories, '; ') as categories,
            to_char(p.published_at, 'YYYY-MM-DD') as published_on,
            p.triage_summary,
            array_to_string(p.claim_touches, '; ') as advisory_claim_touches,
            array_to_string(p.suggested_concepts, '; ') as suggested_concepts,
            p.citation_count,
            p.signal_id::text as promoted_signal_id
       from papers p
      where p.triage_status = 'kept'
      order by p.published_at desc nulls last, p.id${limitClause}`,
    params
  );
}

// The Research Portal's firewall handoff: every tracked or noted paper, full
// corpus every download (no day filter, like signals-export), with its
// extraction jsonb flattened and its CONFIRMED thread placements resolved via
// a join (not the denormalized papers.suggested_threads column, which can
// carry proposals a human never confirmed). review_note never appears here or
// anywhere; rigor_prior rides only because this dataset is key-gated (see the
// scoped exception in scripts/test-datasets.mjs).
export async function buildResearchExport(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select p.id::text as id, p.arxiv_id, p.url, p.title,
            p.review_status::text as review_status,
            to_char(p.published_at, 'YYYY-MM-DD') as published_on,
            to_char(p.reviewed_at, 'YYYY-MM-DD') as reviewed_on,
            p.rigor_prior, p.citation_count, p.author_hindex,
            p.extraction->>'headline_claim'   as headline_claim,
            p.extraction->>'the_test'         as the_test,
            p.extraction->>'effect_size'      as effect_size,
            p.extraction->>'limitations'      as limitations,
            p.extraction->>'counterpoint'     as counterpoint,
            p.extraction->>'econ_implication' as econ_implication,
            (p.extraction->'who_cares')::text as who_cares,
            array_to_string(coalesce((
              select array_agg(t.slug order by t.slug)
                from thread_papers tp
                join research_threads t on t.id = tp.thread_id
               where tp.paper_id = p.id and tp.status = 'confirmed'
            ), '{}'), '; ') as thread_slugs,
            array_to_string(p.claim_touches, '; ') as advisory_claim_touches,
            p.signal_id::text as promoted_signal_id,
            p.analyzed_by,
            p.abstract,
            p.raw_content as full_text
       from papers p
      where p.review_status in ('tracked', 'noted')
      order by p.reviewed_at desc, p.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildScoutCompanies(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // The tracked watchlist only, descriptive facts only. The review funnel, the
  // scoring agent's advisory verdicts and scores, review notes, and the dossier
  // never enter a dataset (a public pursue verdict on a named startup would
  // disclose M&A intent).
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select c.id::text as company_id, c.name, c.domain, c.url,
            c.vertical, v.name as vertical_name,
            c.one_liner, c.ai_tech, c.stage::text as stage,
            c.founded_year, c.funding_note, c.hq, c.origin::text as origin,
            to_char(c.reviewed_at, 'YYYY-MM-DD') as tracked_since,
            (select count(*)::int from company_events e where e.company_id = c.id) as event_count
       from companies c
       join scout_verticals v on v.slug = c.vertical
      where c.status = 'tracked'
      order by c.reviewed_at desc nulls last, c.id${limitClause}`,
    params
  );
}

export async function buildScoutEvents(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Events on tracked companies: the same rows the public profile timeline
  // renders. The note column stays out (it can carry working provenance).
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select e.id::text as event_id, e.company_id::text as company_id,
            c.name as company_name, c.vertical,
            to_char(e.event_date, 'YYYY-MM-DD') as event_date,
            e.kind::text as kind, e.title, e.url
       from company_events e
       join companies c on c.id = e.company_id
      where c.status = 'tracked'
      order by e.event_date desc, e.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildExternalScan(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // One row per item in one day's External Scan run: the latest COMPLETED day
  // by default (a mid-flight run never shifts the default download), or the
  // ?day= the route validated. Run internals (lease, counters) never export.
  const params: unknown[] = [opts.day ?? null];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select i.id::text as item_id,
            to_char(r.day, 'YYYY-MM-DD') as run_day,
            i.url, i.normalized_url, i.headline, i.source_domain,
            to_char(i.published_date, 'YYYY-MM-DD') as published_on,
            i.discovered_via, i.topic_slug, t.taxonomy_code as topic_code,
            i.summary,
            array_to_string(i.tags, '; ') as tags,
            array_to_string(i.entities, '; ') as entities,
            i.relevance,
            i.enrich_status::text as enrich_status,
            i.fetch_status::text as fetch_status,
            i.fetched_via,
            length(i.raw_content) as text_chars,
            i.raw_content as full_text,
            i.enriched_by
       from scan_items i
       join scan_runs r on r.id = i.run_id
       left join scan_topics t on t.slug = i.topic_slug
      where r.day = coalesce($1::date, (select max(day) from scan_runs where status = 'completed'))
      order by i.published_date desc nulls last, i.normalized_url, i.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

interface SignalsExportRow {
  id: string; title: string; summary: string | null;
  significance: 'high' | 'medium' | 'low';
  lenses: string[] | null;
  run_day: string; published_on: string | null; origin: string;
  claim_touches: string[] | null;
  touch_details: Record<string, { direction?: string | null; reason?: string | null }> | null;
  brief_what_happened: string | null; brief_why_it_matters: string | null;
  brief_whats_contested: string | null; counterpoint: string | null;
  source_title: string | null; source_url: string | null;
  article_text: string | null;
}

const SIGNIFICANCE_RELEVANCE: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };

export async function buildSignalsExport(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // The whole published-signal corpus mapped onto the external-scan row shape
  // (same 19 keys, same order) so the same firewall intake ingests both files,
  // with the signal-native fields appended (the contract is additive). This is
  // the ONE builder allowed to read touch_details (per-touch direction plus the
  // editorial reason): the dataset is key-gated, and the portal key is that
  // boundary. full_text is a composed document, writeup first then the retained
  // article text, so even a scan-fields-only intake captures the editorial work.
  const host = (opts.host ?? '').replace(/\/+$/, '') || 'https://ai-atlas-kevin-michel-s-projects.vercel.app';
  const signalParams: unknown[] = [];
  let signalLimitClause = '';
  if (isPositiveInt(opts.limit)) {
    signalParams.push(opts.limit);
    signalLimitClause = ` limit $${signalParams.length}`;
  }
  const [signals, nodes] = await Promise.all([
    q<SignalsExportRow>(
      `select s.id::text as id, s.title, s.summary,
              s.significance::text as significance,
              s.lenses::text[] as lenses,
              to_char(coalesce(s.published_at, s.created_at), 'YYYY-MM-DD') as run_day,
              to_char(s.published_at, 'YYYY-MM-DD') as published_on,
              s.origin::text as origin,
              s.claim_touches, s.touch_details,
              s.brief->>'what_happened'   as brief_what_happened,
              s.brief->>'why_it_matters'  as brief_why_it_matters,
              s.brief->>'whats_contested' as brief_whats_contested,
              s.counterpoint->>'the_other_read' as counterpoint,
              src.title as source_title, src.url as source_url,
              coalesce(src.raw_text, sc.raw_content) as article_text
         from signals s
         left join sources src on src.id = s.source_id
         left join lateral (
           select c.raw_content from signal_candidates c
            where c.signal_id = s.id and c.raw_content is not null
            order by c.retrieved_at desc, c.id limit 1
         ) sc on true
        where s.is_published = true
        order by s.published_at desc nulls last, s.id${signalLimitClause}`,
      signalParams
    ),
    q<{ code: string; statement: string }>(
      `select code, statement from claims where code is not null
       union all
       select code, statement from bridge_claims`
    ),
  ]);
  const statements = new Map(nodes.map((n) => [n.code, n.statement]));

  return signals.map((s) => {
    const atlasUrl = `${host}/signals/${s.id}`;
    const url = s.source_url ?? atlasUrl;
    const touches = (s.claim_touches ?? []).map((code) => {
      const d = s.touch_details?.[code] ?? {};
      return {
        code,
        direction: d.direction ?? null,
        reason: d.reason ?? null,
        statement: statements.get(code) ?? null,
      };
    });

    const parts: string[] = [s.title];
    if (s.summary) parts.push(`SUMMARY: ${s.summary}`);
    if (s.brief_what_happened) parts.push(`WHAT HAPPENED: ${s.brief_what_happened}`);
    if (s.brief_why_it_matters) parts.push(`WHY IT MATTERS: ${s.brief_why_it_matters}`);
    if (s.brief_whats_contested) parts.push(`WHAT IS CONTESTED: ${s.brief_whats_contested}`);
    if (s.counterpoint) parts.push(`COUNTERPOINT: ${s.counterpoint}`);
    if (touches.length) {
      const lines = touches.map((t) => {
        const head = `- ${t.code}${t.direction ? ` (${t.direction})` : ''}${t.statement ? `: ${t.statement}` : ''}`;
        return t.reason ? `${head}\n  ${t.reason}` : head;
      });
      parts.push(`ARGUMENT MAP TOUCHES:\n${lines.join('\n')}`);
    }
    if (s.article_text) parts.push(`SOURCE ARTICLE TEXT:\n${s.article_text}`);
    const fullText = parts.join('\n\n').slice(0, 24_000);

    return {
      item_id: s.id,
      run_day: s.run_day,
      url,
      normalized_url: normalizeUrl(url),
      headline: s.title,
      source_domain: domainOfUrl(url),
      published_on: s.published_on,
      discovered_via: 'atlas_signal',
      topic_slug: null,
      topic_code: null,
      summary: s.summary,
      tags: (s.lenses ?? []).join('; '),
      entities: '',
      relevance: SIGNIFICANCE_RELEVANCE[s.significance] ?? 0.3,
      enrich_status: 'done',
      fetch_status: 'done',
      fetched_via: null,
      text_chars: [...fullText].length,
      full_text: fullText,
      enriched_by: null,
      significance: s.significance,
      lenses: (s.lenses ?? []).join('; '),
      origin: s.origin,
      claim_touches: (s.claim_touches ?? []).join('; '),
      touch_details: JSON.stringify(touches),
      brief_what_happened: s.brief_what_happened,
      brief_why_it_matters: s.brief_why_it_matters,
      brief_whats_contested: s.brief_whats_contested,
      counterpoint: s.counterpoint,
      atlas_url: atlasUrl,
      source_title: s.source_title,
    };
  });
}

// ---------------------------------------------------------------------------
// The Intel Desk (migration 0043). All four builders are KEY-GATED, HEAVY
// datasets: a company-intelligence registry, its daily collected items,
// extracted facts, and LLM-free metrics never ship un-gated. See
// scripts/test-intel-datasets.mjs for the coverage/guest-safety guard.

interface IntelItemQueryRow {
  item_id: string; run_day: string; url: string; normalized_url: string;
  headline: string | null; source_domain: string | null; published_on: string | null;
  discovered_via: string; topic_slug: string | null;
  summary: string | null; tags: string; entities: string;
  relevance: number | null;
  enrich_status: string; fetch_status: string; fetched_via: string | null;
  enriched_by: string | null;
  raw_content: string | null; facts_text: string | null;
  doc_type: string; company_slugs: string; tier: string | null;
}

export async function buildIntelItems(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Mirrors external-scan's twenty columns key for key, in order, so the same
  // firewall intake ingests both files: topic_slug carries the item's primary
  // company_slug, tags carries its dimension tags, relevance carries its
  // significance score. topic_code has no company-level analogue (the
  // taxonomy codes live on dimensions, already riding tags) and is always
  // null here, the same deliberate null buildSignalsExport uses for the same
  // reason. full_text is a COMPOSED document (headline, summary, extracted
  // facts, then the raw article text), not the raw retained text alone, so
  // its text_chars is the composed length; the day resolution mirrors
  // buildExternalScan's latest-completed-day default.
  const params: unknown[] = [opts.day ?? null];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  const rows = await q<IntelItemQueryRow>(
    `select i.id::text as item_id,
            to_char(r.day, 'YYYY-MM-DD') as run_day,
            i.url, i.normalized_url, i.headline, i.source_domain,
            to_char(i.published_date, 'YYYY-MM-DD') as published_on,
            i.discovered_via,
            i.company_slug as topic_slug,
            i.summary,
            array_to_string(i.dimensions, '; ') as tags,
            array_to_string(i.entities, '; ') as entities,
            i.significance as relevance,
            i.enrich_status::text as enrich_status,
            i.fetch_status::text as fetch_status,
            i.fetched_via,
            i.enriched_by,
            i.raw_content,
            fx.facts_text,
            i.doc_type::text as doc_type,
            array_to_string(i.company_slugs, '; ') as company_slugs,
            c.tier::text as tier
       from intel_items i
       join intel_runs r on r.id = i.run_id
       left join intel_companies c on c.slug = i.company_slug
       left join lateral (
         select string_agg(
                  '- [' || f.dimension || '] ' || f.fact
                    || case when f.value_text is not null then ' = ' || f.value_text else '' end
                    || case when f.as_of is not null then ' (as of ' || to_char(f.as_of, 'YYYY-MM-DD') || ')' else '' end,
                  E'\n' order by f.created_at, f.id
                ) as facts_text
           from intel_facts f
          where f.item_id = i.id
       ) fx on true
      where r.day = coalesce($1::date, (select max(day) from intel_runs where status = 'completed'))
      order by i.published_date desc nulls last, i.normalized_url, i.id${limitClause}`,
    params
  );

  return rows.map((r) => {
    const parts: string[] = [];
    if (r.headline) parts.push(r.headline);
    if (r.summary) parts.push(`SUMMARY: ${r.summary}`);
    if (r.facts_text) parts.push(`EXTRACTED FACTS:\n${r.facts_text}`);
    if (r.raw_content) parts.push(`ARTICLE TEXT:\n${r.raw_content}`);
    const fullText = parts.join('\n\n').slice(0, 24_000);
    return {
      item_id: r.item_id,
      run_day: r.run_day,
      url: r.url,
      normalized_url: r.normalized_url,
      headline: r.headline,
      source_domain: r.source_domain,
      published_on: r.published_on,
      discovered_via: r.discovered_via,
      topic_slug: r.topic_slug,
      topic_code: null,
      summary: r.summary,
      tags: r.tags,
      entities: r.entities,
      relevance: r.relevance,
      enrich_status: r.enrich_status,
      fetch_status: r.fetch_status,
      fetched_via: r.fetched_via,
      text_chars: [...fullText].length,
      full_text: fullText,
      enriched_by: r.enriched_by,
      doc_type: r.doc_type,
      company_slugs: r.company_slugs,
      tier: r.tier,
    };
  });
}

// ---------------------------------------------------------------------------

export async function buildIntelCompanies(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // The full registry (tracked and queued alike; the Intel Desk has no
  // review-funnel visibility split like Scout's). Booleans render 'yes'/'no'
  // (the is_frame/one_sided house convention). The dossier is the machine's
  // own merged record (lib/scout/core.ts mergeDossier); products/customers
  // are jsonb arrays, flattened the same way array columns are elsewhere.
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select c.slug, c.name, c.tier::text as tier, c.niche, c.ticker, c.cik,
            c.rssd_id, c.fdic_cert, c.lei, c.domain,
            array_to_string(c.aliases, '; ') as aliases,
            case when c.active then 'yes' else 'no' end as active,
            c.dossier->>'summary' as dossier_summary,
            coalesce(
              (select string_agg(x, '; ')
                 from jsonb_array_elements_text(coalesce(c.dossier->'products', '[]'::jsonb)) x),
              ''
            ) as dossier_initiatives,
            coalesce(
              (select string_agg(x, '; ')
                 from jsonb_array_elements_text(coalesce(c.dossier->'customers', '[]'::jsonb)) x),
              ''
            ) as dossier_segments,
            c.dossier->>'updated_at' as dossier_updated_at,
            to_char(c.created_at, 'YYYY-MM-DD') as created_at,
            to_char(c.updated_at, 'YYYY-MM-DD') as updated_at
       from intel_companies c
      order by c.slug${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildIntelFacts(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // Every extracted fact, provenance intact: source_url resolves through the
  // originating item (nullable; a fact can outlive nothing since both carry
  // on-delete-cascade, but the item join stays a left join for the rare row
  // ingested without one).
  const params: unknown[] = [];
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select f.id::text as fact_id,
            f.company_slug,
            c.name as company_name,
            f.dimension,
            f.fact,
            f.value_text,
            to_char(f.as_of, 'YYYY-MM-DD') as as_of,
            it.url as source_url,
            f.item_id::text as item_id,
            to_char(f.created_at, 'YYYY-MM-DD') as created_at
       from intel_facts f
       join intel_companies c on c.slug = f.company_slug
       left join intel_items it on it.id = f.item_id
      order by f.company_slug, f.created_at desc, f.id${limitClause}`,
    params
  );
}

// ---------------------------------------------------------------------------

export async function buildIntelMetrics(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  // LLM-free structured series (EDGAR XBRL, FDIC, CFPB); no model ever
  // touches this table, so there is no enrichment status to carry.
  // since/source are the incremental-pull filters: an importer that already
  // holds prior rows can ask for only what changed (fetched_at on or after a
  // date) and/or one source, instead of the full ~2M-row corpus every time.
  // Neither set: byte-identical SQL to the unfiltered build.
  const params: unknown[] = [];
  const whereParts: string[] = [];
  if (opts.since) {
    params.push(opts.since);
    whereParts.push(`m.fetched_at >= $${params.length}::date`);
  }
  if (opts.source) {
    params.push(opts.source);
    whereParts.push(`m.source = $${params.length}`);
  }
  const whereClause = whereParts.length ? ` where ${whereParts.join(' and ')}` : '';
  let limitClause = '';
  if (isPositiveInt(opts.limit)) {
    params.push(opts.limit);
    limitClause = ` limit $${params.length}`;
  }
  return q<DatasetRow>(
    `select m.company_slug,
            c.name as company_name,
            m.metric_code,
            to_char(m.period, 'YYYY-MM-DD') as period,
            m.value,
            m.unit,
            m.source,
            to_char(m.fetched_at, 'YYYY-MM-DD') as fetched_at
       from intel_metrics m
       join intel_companies c on c.slug = m.company_slug${whereClause}
      order by m.company_slug, m.metric_code, m.period desc, m.source, m.id${limitClause}`,
    params
  );
}

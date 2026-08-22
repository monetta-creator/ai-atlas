import type { DatasetOpts, DatasetRow, Q } from './core';
// Explicit .ts extension: this chain is loaded by plain Node in
// scripts/test-datasets.mjs (type stripping), which resolves no extensionless
// specifiers. The bundler resolves it identically.
import { domainOfUrl } from '../pack-shared.ts';

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
      order by s.published_at desc nulls last, s.id`,
    params
  );
  return rows.map((r) => ({ ...r, source_domain: domainOfUrl(r.source_url) }));
}

// ---------------------------------------------------------------------------

interface LensTagRow { target_type: string; target_id: string; lens_tags: string }

export async function buildArgumentNodes(q: Q): Promise<DatasetRow[]> {
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
  return out;
}

// ---------------------------------------------------------------------------

export async function buildArgumentEdges(q: Q): Promise<DatasetRow[]> {
  // edges carries no FK (polymorphic uuids); dangling rows resolve to null codes
  // and are dropped here, matching how the app tolerates orphans at read time.
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
      order by 2, 4, 5`
  );
}

// ---------------------------------------------------------------------------

export async function buildEvidenceLedger(q: Q): Promise<DatasetRow[]> {
  // Never selects evidence.note (admin-only) or the source's reliability_prior.
  // The signal guard is belt and braces: syncSignalEvidence removes rows on
  // unpublish, so signal-anchored evidence should already be published-only.
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
      order by e.created_at desc, e.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildSources(q: Q): Promise<DatasetRow[]> {
  // Bibliography of publicly referenced sources only: a source enters when it
  // backs at least one evidence row or one published signal. Admin working rows
  // (unreferenced uploads) stay out. No reliability_prior, no dossier.
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
      order by s.published_at desc nulls last, s.id`
  );
  return rows.map((r) => ({ ...r, source_domain: domainOfUrl(r.url) }));
}

// ---------------------------------------------------------------------------

export async function buildArticlesFullText(q: Q): Promise<DatasetRow[]> {
  // One row per published signal that has article text. Curated source text wins
  // over the pipeline's cached page text; the lateral picks the newest candidate
  // deterministically when several carry text for the same signal.
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
      order by s.published_at desc nulls last, s.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildConcepts(q: Q): Promise<DatasetRow[]> {
  return q<DatasetRow>(
    `select c.slug, c.name, c.short_definition, c.explanation, c.status::text as status,
            (select string_agg(p.slug, '; ' order by p.slug)
               from concept_edges ce join concepts p on p.id = ce.prerequisite_id
              where ce.concept_id = c.id and ce.status = 'confirmed') as prerequisites,
            (select string_agg(cc.target_code, '; ' order by cc.target_code)
               from concept_claims cc
              where cc.concept_id = c.id and cc.status = 'confirmed') as linked_claims
       from concepts c
      order by c.slug`
  );
}

// ---------------------------------------------------------------------------

export async function buildSignalsByClaim(q: Q): Promise<DatasetRow[]> {
  // The touch matrix in long form: one row per (published signal, touched code).
  // direction comes from the evidence row syncSignalEvidence materialized on
  // publish (at most one per pair, by the 0006 unique partial index); a null
  // direction means the touch predates the sync or cites a frame.
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
      order by t.code, s.published_at desc nulls last, s.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildThesisReports(q: Q): Promise<DatasetRow[]> {
  // Reads the frozen guest-safe pack stats straight off thesis_reports; the
  // statement is the frozen one (theses.statement may have moved on).
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
      order by tr.generated_at desc, tr.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildResearchPapers(q: Q): Promise<DatasetRow[]> {
  // The curated library only (triage kept), never the raw funnel. claim_touches
  // here is ADVISORY: papers never write evidence; the only road into the map is
  // promotion to a signal. Excludes the reviewer's private fields (review_note,
  // rigor_prior) by construction.
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
      order by p.published_at desc nulls last, p.id`
  );
}


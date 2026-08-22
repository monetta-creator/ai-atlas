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
// `is_published = true`, the same guest floor as the public feed. Evidence rows
// are only ever surfaced through a published signal or a curated source, and
// sources appear only when publicly referenced by evidence or a published signal.

// ---------------------------------------------------------------------------

export async function buildSignals(q: Q, opts: DatasetOpts = {}): Promise<DatasetRow[]> {
  const params: unknown[] = [];
  let contextClause = '';
  if (opts.context) {
    params.push(opts.context);
    contextClause = `and s.context::text = $${params.length}`;
  }
  const rows = await q<DatasetRow & { source_url: string | null }>(
    `select s.id::text as signal_id, s.title, s.summary,
            s.significance::text as significance,
            s.context::text as context,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.origin::text as origin,
            array_to_string(s.touches, '; ') as touches,
            src.title as source_title, src.url as source_url,
            s.brief->>'what_happened'   as brief_what_happened,
            s.brief->>'why_it_matters'  as brief_why_it_matters,
            s.brief->>'whats_contested' as brief_whats_contested,
            s.counterpoint->>'the_other_read' as counterpoint
       from signals s
       left join sources src on src.id = s.source_id
      where s.is_published = true ${contextClause}
      order by s.published_at desc nulls last, s.id`,
    params
  );
  return rows.map((r) => ({ ...r, source_domain: domainOfUrl(r.source_url) }));
}

// ---------------------------------------------------------------------------

export async function buildHypotheses(q: Q): Promise<DatasetRow[]> {
  // The board's public structure: statements, tests, status, resolvability, and
  // the public evidence tallies. Conviction is the personal layer and is absent.
  return q<DatasetRow>(
    `select h.code, h.statement, h.test,
            h.status::text as status,
            h.resolvability::text as resolvability,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id) as evidence_count,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id and e.direction = 'supports') as supporting,
            (select count(*)::int from evidence e where e.hypothesis_id = h.id and e.direction = 'contradicts') as contradicting,
            (select count(distinct e.signal_id)::int from evidence e
              where e.hypothesis_id = h.id and e.signal_id is not null) as signal_count,
            '/hypothesis/' || h.code as href
       from hypotheses h
      order by substring(h.code from 2)::int nulls last, h.code`
  );
}

// ---------------------------------------------------------------------------

export async function buildHypothesisLinks(q: Q): Promise<DatasetRow[]> {
  // The promote-and-link graph between hypotheses (undirected in meaning; the
  // stored direction is creation order).
  return q<DatasetRow>(
    `select hf.code as from_code, ht.code as to_code, l.note as link_note
       from hypothesis_links l
       join hypotheses hf on hf.id = l.from_id
       join hypotheses ht on ht.id = l.to_id
      order by 1, 2`
  );
}

// ---------------------------------------------------------------------------

export async function buildEvidenceLedger(q: Q): Promise<DatasetRow[]> {
  // Never selects evidence.note (admin-only) or the source's reliability_prior.
  // The signal guard is belt and braces: syncSignalEvidence removes rows on
  // unpublish, so signal-anchored evidence should already be published-only.
  return q<DatasetRow>(
    `select e.id::text as evidence_id,
            h.code as hypothesis_code,
            h.statement as hypothesis_statement,
            e.direction::text as direction,
            e.confidence::text as confidence,
            e.excerpt,
            e.signal_id::text as signal_id,
            sig.title as signal_title,
            src.title as source_title,
            src.url as source_url,
            to_char(e.created_at, 'YYYY-MM-DD') as added_on
       from evidence e
       join hypotheses h   on h.id = e.hypothesis_id
       left join signals sig on sig.id = e.signal_id
       left join sources src on src.id = e.source_id
      where e.signal_id is null or sig.is_published = true
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
  // over the intake-cached text; the lateral picks the newest candidate
  // deterministically when several carry text for the same signal.
  return q<DatasetRow>(
    `select s.id::text as signal_id, s.title as signal_title,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.significance::text as significance,
            s.context::text as context,
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
            (select string_agg(cl.code, '; ' order by cl.code)
               from concept_links cl
              where cl.concept_id = c.id and cl.status = 'confirmed') as linked_hypotheses
       from concepts c
      order by c.slug`
  );
}

// ---------------------------------------------------------------------------

export async function buildSignalsByHypothesis(q: Q): Promise<DatasetRow[]> {
  // The touch matrix in long form: one row per (published signal, touched code).
  // direction comes from the evidence row syncSignalEvidence materialized on
  // publish; a null direction means the touch never materialized.
  return q<DatasetRow>(
    `select t.code as hypothesis_code,
            h.statement as hypothesis_statement,
            s.id::text as signal_id, s.title as signal_title,
            to_char(s.published_at, 'YYYY-MM-DD') as published_on,
            s.significance::text as significance,
            s.context::text as context,
            e.direction::text as direction
       from signals s
      cross join lateral unnest(s.touches) as t(code)
       join hypotheses h on h.code = t.code
       left join evidence e on e.signal_id = s.id and e.hypothesis_id = h.id
      where s.is_published = true
      order by t.code, s.published_at desc nulls last, s.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildHypothesisReports(q: Q): Promise<DatasetRow[]> {
  // Reads the frozen guest-safe pack stats straight off hypothesis_reports; the
  // statement is the frozen one (hypotheses.statement may have moved on).
  return q<DatasetRow>(
    `select hr.id::text as report_id,
            h.code as hypothesis_code,
            hr.statement as hypothesis_statement,
            to_char(hr.generated_at, 'YYYY-MM-DD') as generated_on,
            (hr.pack->'stats'->>'scanned')::int  as signals_scanned,
            (hr.pack->'stats'->>'matched')::int  as signals_matched,
            (hr.pack->'stats'->'directions'->>'supports')::int    as supporting,
            (hr.pack->'stats'->'directions'->>'contradicts')::int as contradicting,
            (hr.pack->'stats'->'directions'->>'neutral')::int     as neutral,
            (hr.pack->'stats'->'directions'->>'untyped')::int     as untyped,
            case when (hr.pack->'stats'->>'oneSided')::boolean then 'yes' else 'no' end as one_sided,
            case when (hr.pack->'stats'->>'thin')::boolean then 'yes' else 'no' end as thin,
            hr.pack->'stats'->>'firstPublished' as first_matched,
            hr.pack->'stats'->>'lastPublished'  as last_matched,
            '/hypothesis-report/' || hr.id as report_url
       from hypothesis_reports hr
       join hypotheses h on h.id = hr.hypothesis_id
      order by hr.generated_at desc, hr.id`
  );
}

// ---------------------------------------------------------------------------

export async function buildResearchPapers(q: Q): Promise<DatasetRow[]> {
  // The curated library only (triage kept), never the raw funnel. touches here
  // is ADVISORY: papers never write evidence; the only road into the record is
  // promotion to a signal. Excludes the reviewer's private fields (review_note,
  // rigor_prior) by construction.
  return q<DatasetRow>(
    `select p.title, p.url, p.abstract,
            to_char(p.published_at, 'YYYY-MM-DD') as published_on,
            p.triage_summary,
            array_to_string(p.touches, '; ') as advisory_touches,
            array_to_string(p.suggested_concepts, '; ') as suggested_concepts,
            p.signal_id::text as promoted_signal_id
       from papers p
      where p.triage_status = 'kept'
      order by p.published_at desc nulls last, p.id`
  );
}

import { exec, one, withTx } from '../db';
import { normalizeUrl, sanitizeText } from '../pipeline/web';
import { intelFactKey, bingNewsFeedUrl } from '../intel/core';
import { mergeDossier } from '../scout/core';
import type { ScoutDossier } from '../scout/core';
import type { IntelStep, IntelDocType, IntelMetricSource } from '../types';

// ---- Intel Desk (migration 0043) --------------------------------------------
// Writers for the daily company-intelligence sweep. intel_runs IS the
// checkpoint state (the scan_runs pattern): the cron route and the console
// Resume advance the same day-keyed row, swept_units checkpoints the
// feeds/search/filings legs per company, and the lease column keeps
// overlapping invocations from double-working.

export async function createIntelRun(day: string): Promise<{ id: string; created: boolean }> {
  const inserted = await one<{ id: string }>(
    `insert into intel_runs (day) values ($1::date)
     on conflict (day) do nothing
     returning id::text as id`,
    [day]
  );
  if (inserted) return { id: inserted.id, created: true };
  const existing = await one<{ id: string }>(
    `select id::text as id from intel_runs where day = $1::date`,
    [day]
  );
  if (!existing) throw new Error('intel run vanished between insert and select');
  return { id: existing.id, created: false };
}

// Take the run lease for ~5 minutes. Also flips a failed run back to running
// (resume). False = another invocation holds it; the caller exits quietly.
export async function claimIntelRun(runId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update intel_runs
        set lease_until = now() + interval '5 minutes',
            status = 'running', error = null, updated_at = now()
      where id = $1
        and status in ('running', 'failed')
        and (lease_until is null or lease_until < now())
      returning id::text as id`,
    [runId]
  );
  return Boolean(row);
}

// Lease renewal between work units (only the holder calls this) and release on
// clean exit (so a same-day manual resume never waits out the lease).
export async function renewIntelLease(runId: string): Promise<void> {
  await exec(`update intel_runs set lease_until = now() + interval '5 minutes' where id = $1`, [runId]);
}

export async function releaseIntelLease(runId: string): Promise<void> {
  await exec(`update intel_runs set lease_until = null, updated_at = now() where id = $1`, [runId]);
}

export async function setIntelStep(runId: string, step: IntelStep): Promise<void> {
  await exec(`update intel_runs set step = $2, updated_at = now() where id = $1`, [runId, step]);
}

// A checkpoint entry, e.g. 'feeds', 'search:<slug>', 'filings:<slug>' (lib/intel/core.ts sweepUnit).
export async function markIntelUnitSwept(runId: string, unit: string): Promise<void> {
  await exec(
    `update intel_runs
        set swept_units = array_append(swept_units, $2), updated_at = now()
      where id = $1 and not ($2 = any(swept_units))`,
    [runId, unit]
  );
}

const COUNTER_COLUMNS = new Set([
  'feed_item_count', 'search_item_count', 'filing_item_count', 'hydrated_count',
  'enriched_count', 'skipped_count', 'fact_count', 'metric_count',
]);

export async function bumpIntelRunCount(runId: string, column: string, delta: number): Promise<void> {
  if (!COUNTER_COLUMNS.has(column)) throw new Error(`unknown intel counter: ${column}`);
  if (!delta) return;
  await exec(
    `update intel_runs set ${column} = ${column} + $2, updated_at = now() where id = $1`,
    [runId, Math.round(delta)]
  );
}

// Persist an invocation's issue notes (the scan 0040 pattern): appended in
// first-occurrence order, deduplicated against what the row already holds,
// capped at 40.
export async function appendIntelRunNotes(runId: string, notes: string[]): Promise<void> {
  const clean = [...new Set(notes.map((n) => sanitizeText(n).trim().slice(0, 300)).filter(Boolean))].slice(0, 20);
  if (!clean.length) return;
  await exec(
    `update intel_runs
        set notes = (
          select coalesce(array_agg(n order by o), '{}') from (
            select n, min(ord) as o
              from unnest(notes || $2::text[]) with ordinality as t(n, ord)
             group by n
             order by min(ord)
             limit 40
          ) d
        ), updated_at = now()
      where id = $1`,
    [runId, clean]
  );
}

export async function completeIntelRun(runId: string): Promise<void> {
  await exec(
    `update intel_runs
        set status = 'completed', step = 'complete', lease_until = null, updated_at = now()
      where id = $1`,
    [runId]
  );
}

export async function failIntelRun(runId: string, error: string): Promise<void> {
  await exec(
    `update intel_runs set status = 'failed', error = $2, lease_until = null, updated_at = now()
      where id = $1`,
    [runId, error.slice(0, 500)]
  );
}

// Discovery inserts (feeds/search/filings all funnel here): dedupe within the
// batch, within the run (the unique constraint), and against the trailing 14
// days GLOBALLY (check-before-insert: a partial unique index over "recent" is
// not expressible, now() not being immutable in an index predicate).
// All-or-nothing per batch via withTx so a retried unit never half-inserts.
export async function insertIntelItems(
  runId: string,
  companySlug: string | null,
  discoveredVia: string,
  items: {
    url: string;
    headline?: string | null;
    source_domain?: string | null;
    published_date?: string | null;
    doc_type?: IntelDocType;
  }[]
): Promise<{ found: number; inserted: number }> {
  if (!items.length) return { found: 0, inserted: 0 };
  return withTx(async (c) => {
    let inserted = 0;
    const seenInBatch = new Set<string>();
    for (const raw of items) {
      const url = String(raw.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const normalized = normalizeUrl(url);
      if (seenInBatch.has(normalized)) continue;
      seenInBatch.add(normalized);
      const recent = await c.query(
        `select 1 from intel_items
          where normalized_url = $1 and created_at > now() - interval '14 days' limit 1`,
        [normalized]
      );
      if (recent.rowCount) continue;
      const published = raw.published_date && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.published_date).trim())
        ? String(raw.published_date).trim()
        : null;
      const res = await c.query(
        `insert into intel_items
           (run_id, company_slug, url, normalized_url, headline, source_domain, published_date,
            discovered_via, doc_type)
         values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9)
         on conflict (run_id, normalized_url) do nothing`,
        [
          runId, companySlug, url.slice(0, 2000), normalized,
          raw.headline ? sanitizeText(raw.headline).slice(0, 500) : null,
          raw.source_domain ? sanitizeText(raw.source_domain).slice(0, 200) : null,
          published, discoveredVia, raw.doc_type ?? 'news',
        ]
      );
      inserted += res.rowCount ?? 0;
    }
    return { found: items.length, inserted };
  });
}

export async function setIntelItemFetchResult(
  id: string,
  r: { status: 'done' | 'failed'; text?: string; via?: string; error?: string }
): Promise<void> {
  if (r.status === 'done') {
    await exec(
      `update intel_items
          set fetch_status = 'done', raw_content = $2, fetched_via = $3, fetch_error = null
        where id = $1`,
      [id, sanitizeText(r.text ?? ''), r.via ?? null]
    );
  } else {
    await exec(
      `update intel_items set fetch_status = 'failed', fetch_error = $2 where id = $1`,
      [id, (r.error ?? 'fetch failed').slice(0, 500)]
    );
  }
}

// company_slug (the primary company) is set from the first companySlugs entry
// ONLY when the column is still null — discovery already stamped it for a
// feed/search item scoped to one company, and enrichment must not overwrite
// that with a different company the model also mentioned. enriched_by is
// stamped on success AND error, for the A/B stats.
export async function setIntelItemEnrichment(
  id: string,
  e: {
    status: 'done' | 'skipped' | 'error';
    summary?: string;
    companySlugs?: string[];
    dimensions?: string[];
    entities?: string[];
    significance?: number | null;
    enrichedBy?: string | null;
  }
): Promise<void> {
  const companySlugs = e.companySlugs ?? [];
  await exec(
    `update intel_items
        set enrich_status = $2, summary = $3, dimensions = $4::text[], entities = $5::text[],
            significance = $6, company_slugs = $7::text[],
            company_slug = coalesce(company_slug, $8),
            enriched_by = coalesce($9, enriched_by)
      where id = $1`,
    [
      id, e.status,
      e.summary ? sanitizeText(e.summary) : null,
      e.dimensions ?? [],
      (e.entities ?? []).map((x) => sanitizeText(x)),
      e.significance ?? null,
      companySlugs,
      companySlugs[0] ?? null,
      e.enrichedBy ?? null,
    ]
  );
}

// Structured facts: pre-deduped within the batch on (company_slug, fact_key) —
// the same natural key as the unique constraint — so a retried batch never
// double-counts. A key conflict against an existing row is treated as
// "already known" and silently skipped.
export async function insertIntelFacts(rows: {
  company_slug: string;
  dimension: string;
  fact: string;
  value_text?: string | null;
  as_of?: string | null;
  item_id?: string | null;
}[]): Promise<number> {
  if (!rows.length) return 0;
  return withTx(async (c) => {
    let inserted = 0;
    const seenInBatch = new Set<string>();
    for (const r of rows) {
      const fact = sanitizeText(r.fact).trim();
      if (!fact || !r.company_slug) continue;
      const key = `${r.company_slug}:${intelFactKey(fact)}`;
      if (seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      const res = await c.query(
        `insert into intel_facts (company_slug, dimension, fact, value_text, as_of, item_id)
         values ($1, $2, $3, $4, $5::date, $6)
         on conflict (company_slug, fact_key) do nothing`,
        [
          r.company_slug, r.dimension, fact.slice(0, 500),
          r.value_text ? sanitizeText(r.value_text).slice(0, 300) : null,
          r.as_of ?? null, r.item_id ?? null,
        ]
      );
      inserted += res.rowCount ?? 0;
    }
    return inserted;
  });
}

// LLM-free structured metrics: idempotent upsert on the natural key, so a
// re-fetch of the same period just refreshes the value.
export async function upsertIntelMetrics(rows: {
  company_slug: string;
  metric_code: string;
  period: string;
  value: number | null;
  unit?: string | null;
  source: IntelMetricSource;
}[]): Promise<number> {
  if (!rows.length) return 0;
  return withTx(async (c) => {
    let n = 0;
    for (const r of rows) {
      const res = await c.query(
        `insert into intel_metrics (company_slug, metric_code, period, value, unit, source)
         values ($1, $2, $3::date, $4, $5, $6)
         on conflict (company_slug, metric_code, period, source) do update
           set value = excluded.value, unit = excluded.unit, fetched_at = now()`,
        [r.company_slug, r.metric_code, r.period, r.value, r.unit ?? null, r.source]
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

// The dossier has multiple writers (the homepage-style enrich sweep, future
// document extraction), so it merges monotonically (lib/scout/core.ts
// mergeDossier, the same function Scout's mergeCompanyDossier uses) instead of
// being replaced wholesale: no writer can erase another's finds.
export async function mergeIntelCompanyDossier(
  slug: string,
  patch: {
    summary: string | null;
    products: string[];
    customers: string[];
    sources: string[];
    updated_by: ScoutDossier['updated_by'];
  }
): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query(`select dossier from intel_companies where slug = $1 for update`, [slug]);
    if (!res.rowCount) return;
    const merged = mergeDossier(res.rows[0].dossier ?? null, patch, new Date().toISOString());
    await c.query(
      `update intel_companies set dossier = $2::jsonb, updated_at = now() where slug = $1`,
      [slug, JSON.stringify(merged)]
    );
  });
}

// Failed-fetch items can never be enriched: sweep them to 'skipped' before an
// enrich wave. Returns the number swept (bumped into skipped_count).
export async function sweepUnenrichableIntelItems(runId: string): Promise<number> {
  return exec(
    `update intel_items set enrich_status = 'skipped'
      where run_id = $1 and enrich_status = 'pending' and fetch_status in ('failed', 'skipped')`,
    [runId]
  );
}

// Budget tripped: everything still pending skips enrichment (the raw text and
// discovery fields still ship in the dataset; summary/dimensions arrive null).
export async function skipAllPendingIntelEnrichment(runId: string): Promise<number> {
  return exec(
    `update intel_items set enrich_status = 'skipped'
      where run_id = $1 and enrich_status = 'pending'`,
    [runId]
  );
}

export async function setIntelCompanyActive(slug: string, active: boolean): Promise<void> {
  await exec(`update intel_companies set active = $2 where slug = $1`, [slug, active]);
}

// The cron on/off switch. Gates the CRON route only; the console's manual
// Run/resume ignores it on purpose.
export async function setIntelEnabled(enabled: boolean): Promise<void> {
  await exec(
    `insert into intel_prefs (id, enabled) values (true, $1)
     on conflict (id) do update set enabled = excluded.enabled, updated_at = now()`,
    [enabled]
  );
}

// The console's enrichment model A/B picker. Ids are validated against the
// registry in the action layer; empty array = the Haiku fallback path.
export async function setIntelEnrichModels(models: string[]): Promise<void> {
  await exec(
    `insert into intel_prefs (id, enrich_models) values (true, $1::text[])
     on conflict (id) do update set enrich_models = excluded.enrich_models, updated_at = now()`,
    [models]
  );
}

export async function setIntelUtilityModel(model: string | null): Promise<void> {
  await exec(
    `insert into intel_prefs (id, utility_model) values (true, $1)
     on conflict (id) do update set utility_model = excluded.utility_model, updated_at = now()`,
    [model]
  );
}

function deriveIntelSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Scout's acquisition funnel and the Intel Desk's registry are separate
// concerns (a tracked target isn't automatically a tracked company on the
// intel side), so promotion is an explicit admin action, not automatic. The
// new row starts tier 'wildcard' (unclassified against the desk's curated
// tiers) with a Google News feed as its only source until the admin curates it.
export async function promoteScoutCompanyToIntel(
  scoutCompanyId: string
): Promise<{ slug: string; created: boolean }> {
  const scout = await one<{ name: string; domain: string | null; url: string | null; vertical: string; one_liner: string | null }>(
    `select name, domain, url, vertical, one_liner from companies where id = $1`,
    [scoutCompanyId]
  );
  if (!scout) throw new Error('scout company not found');
  const slug = deriveIntelSlug(scout.name);
  const inserted = await one<{ slug: string }>(
    `insert into intel_companies (slug, name, tier, niche, domain, aliases, feed_urls, notes)
     values ($1, $2, 'wildcard', $3, $4, $5::text[], $6::text[], $7)
     on conflict (slug) do nothing
     returning slug`,
    [
      slug, sanitizeText(scout.name).slice(0, 200), scout.vertical, scout.domain,
      [scout.name], [bingNewsFeedUrl(scout.name)],
      scout.one_liner ? sanitizeText(scout.one_liner) : null,
    ]
  );
  if (inserted) return { slug: inserted.slug, created: true };
  return { slug, created: false };
}

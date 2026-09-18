import type { PoolClient } from 'pg';
import { exec, one, withTx } from '../db';
import { sanitizeText } from '../pipeline/web';
import { foldRunNotes } from '../run-notes';
import { isScanEnrichModel } from '../scan/models';
import {
  productNameKey, productUrlKey, slugify, normalizeFeatureTags, mergeToolingDossier,
  eventExists, matchExisting, clampFit, isNewsHost,
} from '../tooling/core';
import type {
  ToolingStep, ToolingRunKind, ToolingOrigin, ToolingStatus, ToolingEventKind,
  ToolingMaturity, ToolingDeepDive, ToolingDossier, TriagedProduct,
} from '../types';

// ---- AI Tooling Monitor (migration 0054) --------------------------------------
// Writers for the weekly/pull discovery engine and the admin/portal console.
// Run lifecycle mirrors lib/mutations/intel.ts exactly (the scan_runs /
// intel_runs pattern): tooling_runs IS the checkpoint state, keyed on
// (kind, day) instead of day alone since a weekly run and a pull run can be
// in flight at once.

export async function createToolingRun(kind: ToolingRunKind, day: string): Promise<{ id: string; created: boolean }> {
  const inserted = await one<{ id: string }>(
    `insert into tooling_runs (kind, day) values ($1, $2::date)
     on conflict (kind, day) do nothing
     returning id::text as id`,
    [kind, day]
  );
  if (inserted) return { id: inserted.id, created: true };
  const existing = await one<{ id: string }>(
    `select id::text as id from tooling_runs where kind = $1 and day = $2::date`,
    [kind, day]
  );
  if (!existing) throw new Error('tooling run vanished between insert and select');
  return { id: existing.id, created: false };
}

// Take the run lease for ~5 minutes. Also flips a failed run back to running
// (resume). False = another invocation holds it; the caller exits quietly.
export async function claimToolingRun(runId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update tooling_runs
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

export async function renewToolingLease(runId: string): Promise<void> {
  await exec(`update tooling_runs set lease_until = now() + interval '5 minutes' where id = $1`, [runId]);
}

export async function releaseToolingLease(runId: string): Promise<void> {
  await exec(`update tooling_runs set lease_until = null, updated_at = now() where id = $1`, [runId]);
}

export async function setToolingStep(runId: string, step: ToolingStep): Promise<void> {
  await exec(`update tooling_runs set step = $2, updated_at = now() where id = $1`, [runId, step]);
}

// A checkpoint entry, e.g. 'cat:coding-assistants', 'ph', 'dd:<id>', 'report'
// (lib/tooling/core.ts sweepUnit).
export async function markToolingUnitSwept(runId: string, unit: string): Promise<void> {
  await exec(
    `update tooling_runs
        set swept_units = array_append(swept_units, $2), updated_at = now()
      where id = $1 and not ($2 = any(swept_units))`,
    [runId, unit]
  );
}

const COUNTER_COLUMNS = new Set([
  'found_count', 'inserted_count', 'hydrated_count', 'enriched_count',
  'scored_count', 'cataloged_count', 'deep_dived_count', 'event_count',
]);

export async function bumpToolingRunCount(runId: string, column: string, delta: number): Promise<void> {
  if (!COUNTER_COLUMNS.has(column)) throw new Error(`unknown tooling counter: ${column}`);
  if (!delta) return;
  await exec(
    `update tooling_runs set ${column} = ${column} + $2, updated_at = now() where id = $1`,
    [runId, Math.round(delta)]
  );
}

// Persist an invocation's issue notes (the scan 0040 / intel pattern):
// appended in first-occurrence order, repeats counted instead of dropped
// ("note (x3)", lib/run-notes.ts), capped at 40.
export async function appendToolingRunNotes(runId: string, notes: string[]): Promise<void> {
  const clean = notes.map((n) => sanitizeText(n).trim().slice(0, 300)).filter(Boolean);
  if (!clean.length) return;
  await withTx(async (c) => {
    const row = await c.query<{ notes: string[] | null }>(
      `select coalesce(notes, '{}') as notes from tooling_runs where id = $1 for update`,
      [runId]
    );
    const folded = foldRunNotes(row.rows[0]?.notes ?? [], clean);
    await c.query(`update tooling_runs set notes = $2::text[], updated_at = now() where id = $1`, [runId, folded]);
  });
}

export async function completeToolingRun(runId: string): Promise<void> {
  await exec(
    `update tooling_runs
        set status = 'completed', step = 'complete', lease_until = null, updated_at = now()
      where id = $1`,
    [runId]
  );
}

export async function failToolingRun(runId: string, error: string): Promise<void> {
  await exec(
    `update tooling_runs set status = 'failed', error = $2, lease_until = null, updated_at = now()
      where id = $1`,
    [runId, error.slice(0, 500)]
  );
}

// The stale-run janitor (mirrors failStaleIntelRuns): a weekly run left
// running from a PRIOR week can never be resumed (the cron only ever
// advances the current week's row), so mark it failed with an honest error.
// A pull run has no such natural boundary (it can legitimately run for
// hours/days), so it's flagged stale only after 3 days of no progress.
export async function failStaleToolingRuns(): Promise<number> {
  const weekly = await exec(
    `update tooling_runs
        set status = 'failed', error = 'incomplete: superseded by a newer weekly run', updated_at = now()
      where kind = 'weekly' and status = 'running'
        and day < (date_trunc('week', now() at time zone 'utc'))::date`
  );
  const pull = await exec(
    `update tooling_runs
        set status = 'failed', error = 'incomplete: stale pull run', updated_at = now()
      where kind = 'pull' and status = 'running'
        and updated_at < now() - interval '3 days'`
  );
  return weekly + pull;
}

export async function setToolingRunReport(runId: string, reportId: string): Promise<void> {
  await exec(`update tooling_runs set report_id = $2, updated_at = now() where id = $1`, [runId, reportId]);
}

// ---- Products: dedupe identity shared by insertProducts and createProductManual --

interface MatchRow {
  id: string;
  url_key: string | null;
  name_key: string;
  vendor_domain: string | null;
  status?: ToolingStatus;
}

async function loadExistingForMatch(c: PoolClient): Promise<MatchRow[]> {
  const res = await c.query<MatchRow>(
    `select id::text as id, url_key, name_key, vendor_domain, status from tooling_products`
  );
  return res.rows;
}

// slug candidates in order: the bare name, then vendor-prefixed, then a
// numeric suffix on the vendor-prefixed stem. Pre-checked (not an
// on-conflict retry) because a failed insert would abort the whole
// transaction this runs inside.
async function uniqueSlug(c: PoolClient, name: string, vendor: string | null | undefined): Promise<string> {
  const base = slugify(name);
  const withVendor = vendor ? slugify(`${vendor} ${name}`) : '';
  const stem = withVendor || base || 'product';
  for (const cand of [base, withVendor]) {
    if (!cand) continue;
    const hit = await c.query(`select 1 from tooling_products where slug = $1`, [cand]);
    if (!hit.rowCount) return cand;
  }
  for (let n = 2; ; n += 1) {
    const cand = `${stem}-${n}`;
    const hit = await c.query(`select 1 from tooling_products where slug = $1`, [cand]);
    if (!hit.rowCount) return cand;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

// vendor_domain: the product's own homepage host when known, else the
// discovery article's host UNLESS that's a news/aggregator host (a product
// found via TechCrunch shouldn't be "vendor_domain"-matched to techcrunch.com).
function vendorDomainOf(productUrl: string | null, foundUrl: string, isNews: (h: string) => boolean): string | null {
  if (productUrl) return hostOf(productUrl);
  const foundHost = hostOf(foundUrl);
  return foundHost && !isNews(foundHost) ? foundHost : null;
}

// The dedupe rule (matchExisting): url_key match first, else name_key AND
// (vendor_domain equal or either null). A match on a dismissed row still
// counts as "found" but is NEVER re-inserted or bumped (dismissed is sticky).
// A match otherwise bumps last_seen and appends a 'news' discover event when
// the found_url is new. On no match, insert fresh at status 'candidate'.
export async function insertProducts(
  runId: string | null,
  categorySlug: string,
  origin: ToolingOrigin,
  cands: TriagedProduct[]
): Promise<{ found: number; inserted: number; bumped: number }> {
  if (!cands.length) return { found: 0, inserted: 0, bumped: 0 };
  return withTx(async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    let inserted = 0;
    let bumped = 0;
    const seenUrlKeys = new Set<string>();
    const seenNameKeys = new Set<string>();
    const existing: MatchRow[] = await loadExistingForMatch(c);

    for (const raw of cands) {
      const name = sanitizeText(raw.name ?? '').trim().slice(0, 200);
      if (!name) continue;
      const nameKey = productNameKey(name);
      if (!nameKey) continue;

      const productUrl = raw.product_url && /^https?:\/\//i.test(raw.product_url) ? raw.product_url.trim() : null;
      const urlKey = productUrlKey(productUrl);
      const foundUrl = String(raw.found_url ?? '').trim();
      const vendorDomain = vendorDomainOf(productUrl, foundUrl, isNewsHost);

      if (urlKey ? seenUrlKeys.has(urlKey) : seenNameKeys.has(nameKey)) continue;

      const matchId = matchExisting(existing, { url_key: urlKey, name_key: nameKey, vendor_domain: vendorDomain });
      if (matchId) {
        if (urlKey) seenUrlKeys.add(urlKey); else seenNameKeys.add(nameKey);
        const match = existing.find((e) => e.id === matchId);
        if (match?.status === 'dismissed') continue; // found, never bumped/re-inserted

        await c.query(
          `update tooling_products set last_seen = $2::date, updated_at = now() where id = $1`,
          [matchId, today]
        );
        bumped += 1;

        if (foundUrl) {
          const evRes = await c.query<{ title: string; url: string | null }>(
            `select title, url from tooling_events where product_id = $1`,
            [matchId]
          );
          const title = sanitizeText(raw.found_title || name).slice(0, 300);
          if (!eventExists(evRes.rows, { title, url: foundUrl })) {
            await c.query(
              `insert into tooling_events (product_id, kind, title, url, source)
               values ($1, 'news', $2, $3, 'discover')`,
              [matchId, title, foundUrl.slice(0, 2000)]
            );
          }
        }
        continue;
      }

      if (urlKey) seenUrlKeys.add(urlKey); else seenNameKeys.add(nameKey);
      const slug = await uniqueSlug(c, name, raw.vendor);
      const res = await c.query<{ id: string }>(
        `insert into tooling_products
           (name, slug, vendor, vendor_domain, url, url_key, category, one_liner,
            status, origin, found_url, found_title, run_id, first_seen, last_seen)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'candidate', $9, $10, $11, $12, $13::date, $13::date)
         returning id::text as id`,
        [
          name, slug,
          raw.vendor ? sanitizeText(raw.vendor).slice(0, 200) : null,
          vendorDomain, productUrl, urlKey, categorySlug,
          raw.one_liner ? sanitizeText(raw.one_liner).slice(0, 500) : null,
          origin, foundUrl || null,
          raw.found_title ? sanitizeText(raw.found_title).slice(0, 500) : null,
          runId, today,
        ]
      );
      existing.push({ id: res.rows[0].id, url_key: urlKey, name_key: nameKey, vendor_domain: vendorDomain, status: 'candidate' });
      inserted += 1;
    }
    return { found: cands.length, inserted, bumped };
  });
}

export async function setProductFetchResult(
  id: string,
  r: { text: string; via: string } | { error: string }
): Promise<void> {
  if ('error' in r) {
    await exec(
      `update tooling_products set fetch_error = $2, fetched_at = now(), updated_at = now() where id = $1`,
      [id, r.error.slice(0, 500)]
    );
  } else {
    await exec(
      `update tooling_products
          set raw_content = $2, fetched_via = $3, fetched_at = now(), fetch_error = null, updated_at = now()
        where id = $1`,
      [id, sanitizeText(r.text), r.via]
    );
  }
}

export interface ToolingEnrichmentFacts {
  one_liner?: string | null;
  description?: string | null;
  vendor?: string | null;
  target_buyer?: string[];
  deployment?: string[];
  pricing_model?: string | null;
  pricing_note?: string | null;
  maturity?: ToolingMaturity;
  founded_year?: number | null;
  hq?: string | null;
  notable_customers?: string[];
  integrations?: string[];
  compliance_claims?: string[];
  models_used?: string[];
  changelog_url?: string | null;
}

const clean = (s: string | null | undefined, max: number): string | null =>
  s && s.trim() ? sanitizeText(s).trim().slice(0, max) : null;
const cleanArr = (a: string[] | undefined, max: number): string[] =>
  (a ?? []).map((s) => sanitizeText(String(s ?? '')).trim().slice(0, max)).filter(Boolean);

// Fill-only-null for scalar facts, empty-array-only for array facts (a human
// or an earlier writer's fact is never overwritten by a later enrichment
// pass); maturity's null sentinel is 'unknown' rather than an actual null.
// features gets normalized + unioned with what's already there; the
// dossier's OWN features/customers/integrations/sources merge separately
// via mergeToolingDossier (a slower-moving, monotone record across writers).
export async function setProductEnrichment(
  id: string,
  facts: ToolingEnrichmentFacts,
  features: string[],
  dossierPatch: { summary: string | null; customers: string[]; integrations: string[]; sources: string[] },
  model: string
): Promise<void> {
  const normFeatures = normalizeFeatureTags(features ?? []);
  await withTx(async (c) => {
    const res = await c.query<{ dossier: Record<string, unknown> | null; features: string[] }>(
      `select dossier, features from tooling_products where id = $1 for update`,
      [id]
    );
    if (!res.rowCount) return;
    const mergedFeatures = normalizeFeatureTags([...(res.rows[0].features ?? []), ...normFeatures]);
    const dossier: ToolingDossier = mergeToolingDossier(
      res.rows[0].dossier,
      {
        summary: dossierPatch.summary,
        features: normFeatures,
        customers: cleanArr(dossierPatch.customers, 200),
        integrations: cleanArr(dossierPatch.integrations, 200),
        sources: cleanArr(dossierPatch.sources, 2000),
        updated_by: 'homepage',
      },
      new Date().toISOString()
    );
    await c.query(
      `update tooling_products set
         one_liner = coalesce(one_liner, $2),
         description = coalesce(description, $3),
         vendor = coalesce(vendor, $4),
         target_buyer = case when cardinality(target_buyer) = 0 then $5::text[] else target_buyer end,
         deployment = case when cardinality(deployment) = 0 then $6::text[] else deployment end,
         pricing_model = coalesce(pricing_model, $7),
         pricing_note = coalesce(pricing_note, $8),
         maturity = case when maturity = 'unknown' then $9::tooling_maturity_t else maturity end,
         founded_year = coalesce(founded_year, $10),
         hq = coalesce(hq, $11),
         notable_customers = case when cardinality(notable_customers) = 0 then $12::text[] else notable_customers end,
         integrations = case when cardinality(integrations) = 0 then $13::text[] else integrations end,
         compliance_claims = case when cardinality(compliance_claims) = 0 then $14::text[] else compliance_claims end,
         models_used = case when cardinality(models_used) = 0 then $15::text[] else models_used end,
         features = $16::text[],
         changelog_url = coalesce(changelog_url, $17),
         dossier = $18::jsonb,
         enriched_at = now(), enriched_by = $19, updated_at = now()
       where id = $1`,
      [
        id,
        clean(facts.one_liner, 500), clean(facts.description, 4000), clean(facts.vendor, 200),
        cleanArr(facts.target_buyer, 80), cleanArr(facts.deployment, 80),
        clean(facts.pricing_model, 200), clean(facts.pricing_note, 500),
        facts.maturity ?? 'unknown', facts.founded_year ?? null, clean(facts.hq, 200),
        cleanArr(facts.notable_customers, 200), cleanArr(facts.integrations, 200),
        cleanArr(facts.compliance_claims, 200), cleanArr(facts.models_used, 200),
        mergedFeatures, clean(facts.changelog_url, 500),
        JSON.stringify(dossier), model,
      ]
    );
  });
}

// Enrichment's is_ai_tool=false path: parks the candidate WITHOUT stamping
// reviewed_at (reviewProduct would make this look like a human decision).
// Sticky like every other agent write: never touches a pinned row, and never
// un-catalogs one a human or the scorer already promoted.
export async function parkProductByAgent(id: string, reason: string): Promise<void> {
  await exec(
    `update tooling_products set status = 'parked', agent_reason = $2, updated_at = now()
      where id = $1 and status = 'candidate' and not pinned`,
    [id, clean(reason, 500)]
  );
}

// Never demotes a cataloged product (that's a human decision to undo) and
// never touches a pinned one — the update predicate enforces both. Fit >=
// threshold AND a homepage we could actually read auto-catalogs; otherwise
// the candidate parks (visible to a portal keyholder, not a guest) rather
// than staying an invisible candidate forever. `scores` is loosely typed
// (not the read-side ToolingScores) because it also carries `steal: string[]`.
export async function setProductScores(
  rows: { id: string; fit: number; scores: Record<string, unknown>; reason: string; model: string }[],
  threshold: number
): Promise<void> {
  for (const r of rows) {
    await exec(
      `update tooling_products set
         agent_fit = $2, agent_scores = $3::jsonb, agent_reason = $4, agent_model = $5, agent_at = now(),
         status = case
           when $2 is not null and $2 >= $6 and raw_content is not null then 'cataloged'
           else 'parked'
         end,
         updated_at = now()
       where id = $1 and status = 'candidate' and not pinned`,
      [r.id, clampFit(r.fit), JSON.stringify(r.scores ?? {}), clean(r.reason, 500), r.model, threshold]
    );
  }
}

export async function setProductDeepDive(id: string, deepDive: ToolingDeepDive): Promise<void> {
  await exec(
    `update tooling_products set deep_dive = $2::jsonb, deep_dived_at = now(), updated_at = now() where id = $1`,
    [id, JSON.stringify(deepDive)]
  );
}

// A standalone dossier merge for writers that have no other facts to set
// (the deep dive: it updates strengths/weaknesses/etc into deep_dive
// directly via setProductDeepDive, but the SUMMARY/customers/sources also
// fold into the slower-moving, monotone dossier record). Mirrors
// setProductEnrichment's inline merge, split out because that one always
// pairs a dossier patch with a facts write and this one never does.
export async function mergeProductDossier(
  id: string,
  patch: {
    summary: string | null;
    customers: string[];
    integrations: string[];
    sources: string[];
    updated_by: ToolingDossier['updated_by'];
  }
): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query<{ dossier: Record<string, unknown> | null }>(
      `select dossier from tooling_products where id = $1 for update`,
      [id]
    );
    if (!res.rowCount) return;
    const dossier: ToolingDossier = mergeToolingDossier(
      res.rows[0].dossier,
      {
        summary: patch.summary,
        features: [],
        customers: cleanArr(patch.customers, 200),
        integrations: cleanArr(patch.integrations, 200),
        sources: cleanArr(patch.sources, 2000),
        updated_by: patch.updated_by,
      },
      new Date().toISOString()
    );
    await c.query(`update tooling_products set dossier = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify(dossier)]);
  });
}

// Fill-only-null: finish.ts discovers feed_url once; a later feed-poll call
// (events.ts) passes null and only refreshes feed_checked_at.
export async function setProductFeed(id: string, feedUrl: string | null, checkedAt: string): Promise<void> {
  await exec(
    `update tooling_products
        set feed_url = coalesce(feed_url, $2), feed_checked_at = $3::timestamptz, updated_at = now()
      where id = $1`,
    [id, feedUrl, checkedAt]
  );
}

// Appends a marked-off section to raw_content (e.g. finish.ts's pricing-page
// text) rather than replacing it — the enrichment pass already read the
// homepage text this builds on.
export async function appendProductRawContent(id: string, marker: string, text: string): Promise<void> {
  const body = sanitizeText(text).trim();
  if (!body) return;
  await exec(
    `update tooling_products
        set raw_content = coalesce(raw_content, '') || $2, updated_at = now()
      where id = $1`,
    [id, `\n\n[${marker}]\n${body}`]
  );
}

export async function insertProductEvents(
  productId: string,
  events: { kind: ToolingEventKind; title: string; url?: string | null; date?: string | null; note?: string | null }[],
  source: 'feed' | 'deepdive' | 'discover' | 'manual'
): Promise<{ added: number; skipped: number }> {
  if (!events.length) return { added: 0, skipped: 0 };
  return withTx(async (c) => {
    const existingRes = await c.query<{ title: string; url: string | null }>(
      `select title, url from tooling_events where product_id = $1`,
      [productId]
    );
    let existing = existingRes.rows;
    let added = 0;
    let skipped = 0;
    for (const ev of events) {
      const title = sanitizeText(ev.title ?? '').trim().slice(0, 300);
      if (!title) { skipped += 1; continue; }
      const url = ev.url ? String(ev.url).trim().slice(0, 2000) : null;
      if (eventExists(existing, { title, url: url ?? '' })) { skipped += 1; continue; }
      const dateVal = ev.date && /^\d{4}-\d{2}-\d{2}/.test(ev.date) ? ev.date.slice(0, 10) : null;
      await c.query(
        `insert into tooling_events (product_id, event_date, kind, title, url, note, source)
         values ($1, coalesce($2::date, current_date), $3, $4, $5, $6, $7)`,
        [productId, dateVal, ev.kind, title, url, clean(ev.note, 500), source]
      );
      existing = [...existing, { title, url }];
      added += 1;
    }
    return { added, skipped };
  });
}

export async function deleteProductEvent(id: string): Promise<void> {
  await exec(`delete from tooling_events where id = $1`, [id]);
}

export async function reviewProduct(
  id: string,
  status: ToolingStatus,
  pinned: boolean,
  note: string | null
): Promise<void> {
  await exec(
    `update tooling_products
        set status = $2, pinned = $3, review_note = $4, reviewed_at = now(), updated_at = now()
      where id = $1`,
    [id, status, pinned, clean(note, 1000)]
  );
}

// Clears the "unreviewed entrant" nav badge without touching status/pin/note
// (a bulk "mark reviewed" over the curation queue).
export async function markProductsReviewed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await exec(
    `update tooling_products set reviewed_at = now(), updated_at = now() where id = any($1::uuid[])`,
    [ids]
  );
}

// The console's "rescore" action on a parked row: clears agent_at so the
// scorer's getUnscoredIds picks it up again, and un-parks it back to
// candidate so the scoring writer's own sticky predicate (status =
// 'candidate' and not pinned) can act on it. Pinned rows are left alone
// entirely (their status and score stay put; a pinned row is a human's
// standing decision, not something a rescore should touch).
export async function resetProductScores(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await exec(
    `update tooling_products
        set agent_at = null,
            status = case when status = 'parked' and not pinned then 'candidate' else status end,
            updated_at = now()
      where id = any($1::uuid[]) and not pinned`,
    [ids]
  );
}

const EDITABLE_PRODUCT_FIELDS = new Set([
  'name', 'vendor', 'vendor_domain', 'url', 'category', 'secondary_categories', 'one_liner', 'description',
  'target_buyer', 'deployment', 'pricing_model', 'pricing_note', 'maturity', 'founded_year', 'hq',
  'funding_note', 'notable_customers', 'integrations', 'compliance_claims', 'models_used', 'features',
  'feed_url', 'changelog_url', 'github_repo',
]);

// A human overwrite of the allow-listed editable columns — direct set, not
// coalesce/union: a human's edit always wins over whatever enrichment wrote.
export async function updateProductFacts(id: string, patch: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => EDITABLE_PRODUCT_FIELDS.has(k));
  if (!entries.length) return;
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, value] of entries) {
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  await exec(`update tooling_products set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
}

// A manual admin/portal add: the SAME global dedupe as discovery
// (matchExisting), so adding a product that discovery already found lands on
// the existing row instead of creating a twin.
export async function createProductManual(input: {
  name: string;
  vendor?: string | null;
  url?: string | null;
  category: string;
  one_liner?: string | null;
}): Promise<{ id: string; slug: string; existed: boolean }> {
  return withTx(async (c) => {
    const name = sanitizeText(input.name).trim().slice(0, 200);
    const nameKey = productNameKey(name);
    const url = input.url && /^https?:\/\//i.test(input.url) ? input.url.trim() : null;
    const urlKey = productUrlKey(url);
    const vendorDomain = url ? hostOf(url) : null;

    const existing = await loadExistingForMatch(c);
    const matchId = matchExisting(existing, { url_key: urlKey, name_key: nameKey, vendor_domain: vendorDomain });
    if (matchId) {
      const row = await c.query<{ slug: string }>(`select slug from tooling_products where id = $1`, [matchId]);
      return { id: matchId, slug: row.rows[0]?.slug ?? '', existed: true };
    }

    const slug = await uniqueSlug(c, name, input.vendor);
    const res = await c.query<{ id: string }>(
      `insert into tooling_products
         (name, slug, vendor, vendor_domain, url, url_key, category, one_liner, status, origin, first_seen, last_seen)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'candidate', 'manual', current_date, current_date)
       returning id::text as id`,
      [
        name, slug, clean(input.vendor, 200), vendorDomain, url, urlKey, input.category, clean(input.one_liner, 500),
      ]
    );
    return { id: res.rows[0].id, slug, existed: false };
  });
}

// Keeps existing queries when the incoming arrays are empty (the
// upsertVertical pattern) — an admin editing a category's name shouldn't
// blank out its discovery templates by omission.
export async function upsertToolingCategory(input: {
  slug: string;
  name: string;
  description?: string | null;
  search_queries?: string[];
  pull_queries?: string[];
  hn_query?: string | null;
  github_query?: string | null;
  sort_order?: number;
}): Promise<void> {
  await exec(
    `insert into tooling_categories (slug, name, description, search_queries, pull_queries, hn_query, github_query, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (slug) do update
       set name = excluded.name,
           description = excluded.description,
           search_queries = case when array_length(excluded.search_queries, 1) is null
                             then tooling_categories.search_queries else excluded.search_queries end,
           pull_queries = case when array_length(excluded.pull_queries, 1) is null
                             then tooling_categories.pull_queries else excluded.pull_queries end,
           hn_query = excluded.hn_query,
           github_query = excluded.github_query,
           sort_order = excluded.sort_order,
           updated_at = now()`,
    [
      input.slug, sanitizeText(input.name).slice(0, 80),
      clean(input.description, 500),
      input.search_queries ?? [], input.pull_queries ?? [],
      clean(input.hn_query, 200), clean(input.github_query, 200),
      input.sort_order ?? 0,
    ]
  );
}

export async function setToolingCategoryActive(slug: string, active: boolean): Promise<void> {
  await exec(`update tooling_categories set active = $2, updated_at = now() where slug = $1`, [slug, active]);
}

export interface ToolingPrefsPatch {
  enabled?: boolean;
  steering?: string | null;
  rubric?: string | null;
  utility_model?: string | null;
  enrich_model?: string | null;
  catalog_threshold?: number;
  deep_dive_threshold?: number;
  deep_dive_cap?: number;
  auto_publish_entrants?: boolean;
}

// Lazy upsert on id = true: reads the current row (or the code defaults) and
// writes back only the validated fields the caller actually passed.
// Thresholds clamp to 0-100, the deep-dive cap to 0-50, and a model id must
// be a real SCAN_ENRICH_MODELS entry or null (never an arbitrary string).
export async function saveToolingPrefs(patch: ToolingPrefsPatch): Promise<void> {
  const current = await one<{
    enabled: boolean; steering: string | null; rubric: string | null;
    utility_model: string | null; enrich_model: string | null;
    catalog_threshold: number; deep_dive_threshold: number; deep_dive_cap: number;
    auto_publish_entrants: boolean;
  }>(
    `select enabled, steering, rubric, utility_model, enrich_model,
            catalog_threshold, deep_dive_threshold, deep_dive_cap, auto_publish_entrants
       from tooling_prefs where id = true`
  );

  const clampPct = (n: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
  const clampCap = (n: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(50, Math.max(0, Math.round(n))) : fallback;
  const validModel = (m: string | null | undefined, fallback: string | null): string | null => {
    if (m === undefined) return fallback;
    if (m === null || !m.trim()) return null;
    return isScanEnrichModel(m) ? m : fallback;
  };

  const next = {
    enabled: patch.enabled ?? current?.enabled ?? true,
    steering: patch.steering !== undefined ? clean(patch.steering, 4000) : current?.steering ?? null,
    rubric: patch.rubric !== undefined ? clean(patch.rubric, 8000) : current?.rubric ?? null,
    utility_model: validModel(patch.utility_model, current?.utility_model ?? null),
    enrich_model: validModel(patch.enrich_model, current?.enrich_model ?? null),
    catalog_threshold: patch.catalog_threshold !== undefined
      ? clampPct(patch.catalog_threshold, current?.catalog_threshold ?? 60) : current?.catalog_threshold ?? 60,
    deep_dive_threshold: patch.deep_dive_threshold !== undefined
      ? clampPct(patch.deep_dive_threshold, current?.deep_dive_threshold ?? 75) : current?.deep_dive_threshold ?? 75,
    deep_dive_cap: patch.deep_dive_cap !== undefined
      ? clampCap(patch.deep_dive_cap, current?.deep_dive_cap ?? 15) : current?.deep_dive_cap ?? 15,
    auto_publish_entrants: patch.auto_publish_entrants ?? current?.auto_publish_entrants ?? true,
  };

  await exec(
    `insert into tooling_prefs
       (id, enabled, steering, rubric, utility_model, enrich_model,
        catalog_threshold, deep_dive_threshold, deep_dive_cap, auto_publish_entrants)
     values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       enabled = excluded.enabled, steering = excluded.steering, rubric = excluded.rubric,
       utility_model = excluded.utility_model, enrich_model = excluded.enrich_model,
       catalog_threshold = excluded.catalog_threshold, deep_dive_threshold = excluded.deep_dive_threshold,
       deep_dive_cap = excluded.deep_dive_cap, auto_publish_entrants = excluded.auto_publish_entrants,
       updated_at = now()`,
    [
      next.enabled, next.steering, next.rubric, next.utility_model, next.enrich_model,
      next.catalog_threshold, next.deep_dive_threshold, next.deep_dive_cap, next.auto_publish_entrants,
    ]
  );
}

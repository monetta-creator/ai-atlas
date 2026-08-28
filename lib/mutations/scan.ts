import { exec, one, withTx } from '../db';
import { normalizeUrl, sanitizeText } from '../pipeline/web';
import type { ScanStep } from '../types';

// ---- External Scan (migration 0038) -----------------------------------------
// Writers for the daily scan. scan_runs IS the checkpoint state: the cron
// route and the console Resume advance the same day-keyed row, and the lease
// column keeps overlapping invocations from double-working.

export async function createScanRun(day: string): Promise<{ id: string; created: boolean }> {
  const inserted = await one<{ id: string }>(
    `insert into scan_runs (day) values ($1::date)
     on conflict (day) do nothing
     returning id::text as id`,
    [day]
  );
  if (inserted) return { id: inserted.id, created: true };
  const existing = await one<{ id: string }>(
    `select id::text as id from scan_runs where day = $1::date`,
    [day]
  );
  if (!existing) throw new Error('scan run vanished between insert and select');
  return { id: existing.id, created: false };
}

// Take the run lease for ~5 minutes. Also flips a failed run back to running
// (resume). False = another invocation holds it; the caller exits quietly.
export async function claimScanRun(runId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update scan_runs
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
export async function renewScanLease(runId: string): Promise<void> {
  await exec(`update scan_runs set lease_until = now() + interval '5 minutes' where id = $1`, [runId]);
}

export async function releaseScanLease(runId: string): Promise<void> {
  await exec(`update scan_runs set lease_until = null, updated_at = now() where id = $1`, [runId]);
}

export async function setScanStep(runId: string, step: ScanStep): Promise<void> {
  await exec(`update scan_runs set step = $2, updated_at = now() where id = $1`, [runId, step]);
}

export async function markScanTopicSearched(runId: string, slug: string): Promise<void> {
  await exec(
    `update scan_runs
        set searched_topics = array_append(searched_topics, $2), updated_at = now()
      where id = $1 and not ($2 = any(searched_topics))`,
    [runId, slug]
  );
}

const COUNTER_COLUMNS = new Set([
  'feed_item_count', 'search_item_count', 'hydrated_count', 'enriched_count', 'skipped_count',
]);

export async function bumpScanRunCount(runId: string, column: string, delta: number): Promise<void> {
  if (!COUNTER_COLUMNS.has(column)) throw new Error(`unknown scan counter: ${column}`);
  if (!delta) return;
  await exec(
    `update scan_runs set ${column} = ${column} + $2, updated_at = now() where id = $1`,
    [runId, Math.round(delta)]
  );
}

export async function completeScanRun(runId: string): Promise<void> {
  await exec(
    `update scan_runs
        set status = 'completed', step = 'complete', lease_until = null, updated_at = now()
      where id = $1`,
    [runId]
  );
}

export async function failScanRun(runId: string, error: string): Promise<void> {
  await exec(
    `update scan_runs set status = 'failed', error = $2, lease_until = null, updated_at = now()
      where id = $1`,
    [runId, error.slice(0, 500)]
  );
}

// Discovery inserts: dedupe within the batch, within the run (the unique
// constraint), and against the trailing 14 days GLOBALLY (check-before-insert:
// a partial unique index over "recent" is not expressible, now() not being
// immutable in an index predicate). All-or-nothing per batch via withTx so a
// retried unit never half-inserts.
export async function insertScanItems(
  runId: string,
  topicSlug: string | null,
  discoveredVia: string,
  items: { url: string; headline: string; source_domain: string; published_date: string }[]
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
        `select 1 from scan_items
          where normalized_url = $1 and created_at > now() - interval '14 days' limit 1`,
        [normalized]
      );
      if (recent.rowCount) continue;
      const published = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.published_date ?? '').trim())
        ? raw.published_date.trim()
        : null;
      const res = await c.query(
        `insert into scan_items
           (run_id, topic_slug, url, normalized_url, headline, source_domain, published_date, discovered_via)
         values ($1, $2, $3, $4, $5, $6, $7::date, $8)
         on conflict (run_id, normalized_url) do nothing`,
        [
          runId, topicSlug, url.slice(0, 2000), normalized,
          raw.headline ? sanitizeText(raw.headline).slice(0, 500) : null,
          raw.source_domain ? sanitizeText(raw.source_domain).slice(0, 200) : null,
          published, discoveredVia,
        ]
      );
      inserted += res.rowCount ?? 0;
    }
    return { found: items.length, inserted };
  });
}

export async function setScanItemFetchResult(
  id: string,
  r: { status: 'done' | 'failed'; text?: string; via?: string; error?: string }
): Promise<void> {
  if (r.status === 'done') {
    await exec(
      `update scan_items
          set fetch_status = 'done', raw_content = $2, fetched_via = $3, fetch_error = null
        where id = $1`,
      [id, sanitizeText(r.text ?? ''), r.via ?? null]
    );
  } else {
    await exec(
      `update scan_items set fetch_status = 'failed', fetch_error = $2 where id = $1`,
      [id, (r.error ?? 'fetch failed').slice(0, 500)]
    );
  }
}

export async function setScanItemEnrichment(
  id: string,
  e: {
    status: 'done' | 'skipped' | 'error';
    summary?: string;
    tags?: string[];
    entities?: string[];
    relevance?: number | null;
  }
): Promise<void> {
  await exec(
    `update scan_items
        set enrich_status = $2, summary = $3, tags = $4::text[], entities = $5::text[], relevance = $6
      where id = $1`,
    [
      id, e.status,
      e.summary ? sanitizeText(e.summary) : null,
      e.tags ?? [],
      (e.entities ?? []).map((x) => sanitizeText(x)),
      e.relevance ?? null,
    ]
  );
}

// Failed-fetch items can never be enriched: sweep them to 'skipped' before an
// enrich wave. Returns the number swept (bumped into skipped_count).
export async function sweepUnenrichableItems(runId: string): Promise<number> {
  return exec(
    `update scan_items set enrich_status = 'skipped'
      where run_id = $1 and enrich_status = 'pending' and fetch_status in ('failed', 'skipped')`,
    [runId]
  );
}

// Budget tripped: everything still pending skips enrichment (the raw text and
// discovery fields still ship in the dataset; summary/tags arrive null).
export async function skipAllPendingEnrichment(runId: string): Promise<number> {
  return exec(
    `update scan_items set enrich_status = 'skipped'
      where run_id = $1 and enrich_status = 'pending'`,
    [runId]
  );
}

export async function setScanTopicActive(slug: string, active: boolean): Promise<void> {
  await exec(`update scan_topics set active = $2 where slug = $1`, [slug, active]);
}

// The cron on/off switch (0039 singleton, created lazily here). Gates the
// CRON route only; the console's manual Run/resume ignores it on purpose.
export async function setScanEnabled(enabled: boolean): Promise<void> {
  await exec(
    `insert into scan_prefs (id, enabled) values (true, $1)
     on conflict (id) do update set enabled = excluded.enabled, updated_at = now()`,
    [enabled]
  );
}

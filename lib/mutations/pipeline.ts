import { one, exec, withTx } from '../db';
import type {
  SignalLens,
  RunCadence, RunStatus, RunStep, TriageStatus, AnalysisStatus, } from '../types';
import { sanitizeText } from '../pipeline/web';
import type { RawCandidate } from '../pipeline/web';
import { PIPELINE_DAY_START_SQL } from '../pipeline/config';

// ---- Discovery pipeline ----------------------------------------------------

export async function createRun(cadence: RunCadence): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into pipeline_runs (cadence, status, step) values ($1, 'running', 'discovery') returning id`,
    [cadence]
  );
  return row!.id;
}

export async function updateRun(
  id: string,
  fields: Partial<{ status: RunStatus; step: RunStep; error: string | null }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status !== undefined) { params.push(fields.status); sets.push(`status = $${params.length}`); }
  if (fields.step !== undefined) { params.push(fields.step); sets.push(`step = $${params.length}`); }
  if (fields.error !== undefined) { params.push(fields.error); sets.push(`error = $${params.length}`); }
  if (!sets.length) return;
  params.push(id);
  await exec(`update pipeline_runs set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

// Persist an invocation's issue notes (0047): appended in first-occurrence
// order, deduplicated against what the row already holds, capped at 40.
// Mirrors appendScanRunNotes / appendIntelRunNotes / appendResearchRunNotes.
export async function appendPipelineRunNotes(runId: string, notes: string[]): Promise<void> {
  const clean = [...new Set(notes.map((n) => sanitizeText(n).trim().slice(0, 300)).filter(Boolean))].slice(0, 20);
  if (!clean.length) return;
  await exec(
    `update pipeline_runs
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

// The stale-run janitor: a daily run left 'running' from a prior day can never
// be resumed (the cron only advances today's run), so mark it failed with an
// honest error instead of letting the row lie forever in the console/tracker.
export async function failStaleDailyRuns(): Promise<number> {
  return exec(
    `update pipeline_runs
        set status = 'failed', error = 'incomplete: superseded by a newer daily run', updated_at = now()
      where cadence = 'daily' and status = 'running'
        and created_at < ${PIPELINE_DAY_START_SQL}`
  );
}

// Persist the post-run coverage-check result (migration 0026). Overwrites: re-running
// the check on a resumed run replaces the stale audit with the current one.
export async function setRunCoverage(id: string, coverage: unknown): Promise<void> {
  await exec(
    `update pipeline_runs set coverage = $1::jsonb, updated_at = now() where id = $2`,
    [JSON.stringify(coverage), id]
  );
}

// Recompute the run tallies straight from its candidates + linked signals (cheap,
// keeps the polled counts honest no matter which step ran or was re-run).
export async function recomputeRunCounts(id: string): Promise<void> {
  await exec(
    `update pipeline_runs r set
       candidate_count = (select count(*) from signal_candidates c where c.run_id = r.id),
       approved_count  = (select count(*) from signal_candidates c where c.run_id = r.id and c.triage_status = 'approved'),
       signal_count    = (select count(*) from signal_candidates c where c.run_id = r.id and c.signal_id is not null),
       updated_at = now()
     where r.id = $1`,
    [id]
  );
}

// Bulk-insert discovered candidates; unique(run_id,url) makes re-running a batch a no-op.
// Returns how many rows were actually new. `queries` records the search batch that
// surfaced these candidates (migration 0016 — makes query-level hit rates learnable).
export async function insertCandidates(
  runId: string, lens: SignalLens, items: RawCandidate[], queries: string[] = []
): Promise<number> {
  if (!items.length) return 0;
  let inserted = 0;
  await withTx(async (c) => {
    for (const it of items) {
      const pub = /^\d{4}-\d{2}-\d{2}/.test(it.published_date) ? it.published_date.slice(0, 10) : null;
      const res = await c.query(
        `insert into signal_candidates (run_id, lens, url, headline, source_domain, published_date, discovery_queries)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (run_id, url) do nothing`,
        [runId, lens, it.url, it.headline || null, it.source_domain || null, pub, queries.length ? queries : null]
      );
      inserted += res.rowCount ?? 0;
    }
  });
  return inserted;
}

export async function setTriage(
  candidateId: string, status: TriageStatus, reason: string | null
): Promise<void> {
  await exec(
    `update signal_candidates set triage_status = $1, triage_reason = $2, updated_at = now() where id = $3`,
    [status, reason, candidateId]
  );
}

export async function setCandidateRawContent(
  candidateId: string,
  text: string | null,
  via?: 'direct' | 'jina'
): Promise<void> {
  // Defense-in-depth: a NUL anywhere in the text kills the whole update (Postgres `text`
  // rejects 0x00 — the bug that flagged every PDF candidate). The fetch layer sanitizes
  // too, but no caller should be able to reintroduce it.
  const clean = text == null ? null : sanitizeText(text);
  await exec(
    `update signal_candidates
        set raw_content = $1, fetched_via = coalesce($2, fetched_via), updated_at = now()
      where id = $3`,
    [clean, via ?? null, candidateId]
  );
}

// The retained-text guard's writer: keep fetched article text on the signal's
// source row. Fill-only by design — it never clobbers text already present
// (curated ingest text always wins over a refetch).
export async function setSourceRawText(sourceId: string, text: string): Promise<void> {
  await exec(
    `update sources set raw_text = $1, updated_at = now()
      where id = $2 and (raw_text is null or length(raw_text) = 0)`,
    [sanitizeText(text), sourceId]
  );
}

// Archive / unarchive a discovered candidate (migration 0013) — set it aside out of the
// active review queue and the funnel's live buckets, or restore it. archived_at is
// orthogonal to triage_status (the triage decision is preserved), mirroring how signals
// archive via archived_at. Recoverable, with an audit timestamp.
export async function setCandidateArchived(candidateId: string, archived: boolean): Promise<void> {
  await exec(
    `update signal_candidates set archived_at = ${archived ? 'now()' : 'null'}, updated_at = now() where id = $1`,
    [candidateId]
  );
}

// Record a candidate's analysis outcome (migration 0007). 'drafted' is written inside
// createDraftForCandidate's transaction; this writes the non-success outcomes ('error' on
// a failed attempt, 'discarded' when the orchestrator gives up). triage_status is left
// alone so the triage funnel and analysis-health views stay independent.
export async function setAnalysisStatus(
  candidateId: string, status: AnalysisStatus, error: string | null
): Promise<void> {
  await exec(
    `update signal_candidates set analysis_status = $1, analysis_error = $2, updated_at = now() where id = $3`,
    [status, error, candidateId]
  );
}

// ---- Pipeline 2.0: the cron engine's checkpoint + lease + prefs (0042) ------

// Mark one discovery unit done ('market:0', 'sweep'). Append-if-absent, so a
// retried unit never double-records.
export async function markDiscoveryUnitDone(runId: string, unit: string): Promise<void> {
  await exec(
    `update pipeline_runs
        set discovered_units = (select coalesce(array_agg(distinct u), '{}')
                                  from unnest(discovered_units || $2::text) u),
            updated_at = now()
      where id = $1`,
    [runId, unit]
  );
}

// The overlap guard (the scan's claimScanRun pattern): take the lease when the
// run is workable and no live lease is held. False = another invocation is on it.
export async function claimPipelineRun(runId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update pipeline_runs
        set lease_until = now() + interval '5 minutes', updated_at = now()
      where id = $1
        and status in ('running', 'failed')
        and (lease_until is null or lease_until < now())
      returning id`,
    [runId]
  );
  return Boolean(row);
}

export async function renewPipelineLease(runId: string): Promise<void> {
  await exec(`update pipeline_runs set lease_until = now() + interval '5 minutes' where id = $1`, [runId]);
}

export async function releasePipelineLease(runId: string): Promise<void> {
  await exec(`update pipeline_runs set lease_until = null where id = $1`, [runId]);
}

// The /pipeline prefs singleton (0042): cron on/off and the analysis A/B picker.
export async function setPipelineEnabled(enabled: boolean): Promise<void> {
  await exec(
    `insert into pipeline_prefs (id, enabled) values (true, $1)
     on conflict (id) do update set enabled = excluded.enabled, updated_at = now()`,
    [enabled]
  );
}

export async function setPipelineAnalysisModels(models: string[]): Promise<void> {
  await exec(
    `insert into pipeline_prefs (id, analysis_models) values (true, $1::text[])
     on conflict (id) do update set analysis_models = excluded.analysis_models, updated_at = now()`,
    [models]
  );
}

// Reuse an existing source row for a URL, or create a bare one. Returns the source id
// so a pipeline-created signal can link to it (admin sets the reliability prior later).
export async function ensureSource(
  input: { url: string; title?: string | null; outlet?: string | null }
): Promise<string> {
  const existing = await one<{ id: string }>(
    `select id from sources where url = $1 order by created_at limit 1`,
    [input.url]
  );
  if (existing) return existing.id;
  const row = await one<{ id: string }>(
    `insert into sources (title, outlet, url) values ($1, $2, $3) returning id`,
    [input.title || null, input.outlet || null, input.url]
  );
  return row!.id;
}

import { one, exec, withTx } from '../db';
import type { PoolClient } from 'pg';
import type {
  Direction, Significance, SignalLens,
  SignalOrigin, DedupeRecommendation,
  } from '../types';

// ---- Signal Board ----------------------------------------------------------
// Arrays are passed as JS arrays and cast to their Postgres types in SQL
// (signal_lens_t[] / text[]). published_at defaults to now() when not supplied.

interface SignalInput {
  title: string;
  summary?: string | null;
  significance: Significance;
  lenses: SignalLens[];
  claim_touches: string[];
  // Per-touch {direction, reason} keyed by code; the source of truth for the evidence
  // a signal materializes on publish. Codes are a subset of claim_touches.
  touch_details?: Record<string, { direction: Direction; reason: string }>;
  source_id?: string | null;
  published_at?: string | null;
  // Model that drafted a pipeline signal (0042; the analysis A/B stamp).
  // Null for human-authored signals; admin-only surface, never SELECTed publicly.
  drafted_by?: string | null;
}

// Sync a signal's materialized evidence to its publish state — the structural joint
// between the Signal Board and the Argument Map. Deletes any evidence previously
// materialized from this signal (idempotent re-sync), then, when publishing, inserts
// one evidence row per resolvable touch. This is the moment a signal's findings enter
// the map, mirroring the human gate (model proposes a draft; publishing commits it).
async function syncSignalEvidence(
  c: PoolClient, signalId: string, publish: boolean
): Promise<void> {
  await c.query(`delete from evidence where signal_id = $1`, [signalId]);
  if (!publish) return;

  const sig = (
    await c.query(
      `select claim_touches, touch_details, source_id, lenses::text[] as lenses
         from signals where id = $1`,
      [signalId]
    )
  ).rows[0] as
    | {
        claim_touches: string[];
        touch_details: Record<string, { direction?: string; reason?: string }> | null;
        source_id: string | null;
        lenses: string[] | null;
      }
    | undefined;
  if (!sig || !sig.claim_touches?.length) return;

  // Resolve every touched code to a real (target_type, target_id) in one query.
  const resolved = (
    await c.query(
      `select code, 'claim'::text as type, id from claims where code = any($1)
       union all
       select code, 'bridge_claim'::text as type, id from bridge_claims where code = any($1)`,
      [sig.claim_touches]
    )
  ).rows as { code: string; type: 'claim' | 'bridge_claim'; id: string }[];
  const byCode = new Map(resolved.map((r) => [r.code, r]));

  const details = sig.touch_details ?? {};
  const lens = sig.lenses && sig.lenses.length ? sig.lenses[0] : null; // representative audience lens
  const validDir = new Set<string>(['supports', 'contradicts', 'neutral']);

  for (const code of sig.claim_touches) {
    const target = byCode.get(code);
    if (!target) continue; // a code that no longer names a live claim/bridge is skipped
    const d = details[code] ?? {};
    const direction = validDir.has(d.direction ?? '') ? d.direction : 'neutral';
    await c.query(
      `insert into evidence (signal_id, source_id, target_type, target_id, direction, weight, excerpt, lens)
       values ($1, $2, $3, $4, $5, 'medium', $6, $7::signal_lens_t)`,
      [signalId, sig.source_id, target.type, target.id, direction, d.reason ? String(d.reason) : null, lens]
    );
  }
}

// The one INSERT into `signals`, shared by both writers below so the column list / casts can
// never drift between the manual and pipeline paths. is_published + origin are always explicit.
async function insertSignalRow(
  c: PoolClient,
  input: SignalInput & { is_published: boolean; origin: SignalOrigin }
): Promise<string> {
  const row = (
    await c.query(
      `insert into signals
         (title, summary, significance, lenses, claim_touches, touch_details, source_id, published_at, is_published, origin, drafted_by)
       values ($1, $2, $3, $4::signal_lens_t[], $5::text[], $6::jsonb, $7, coalesce($8::timestamptz, now()), $9, $10, $11)
       returning id`,
      [
        input.title,
        input.summary || null,
        input.significance,
        input.lenses,
        input.claim_touches,
        JSON.stringify(input.touch_details ?? {}),
        input.source_id || null,
        input.published_at || null,
        input.is_published,
        input.origin,
        input.drafted_by ?? null,
      ]
    )
  ).rows[0] as { id: string };
  return row.id;
}

export async function createSignal(
  input: SignalInput & { is_published?: boolean; origin?: SignalOrigin }
): Promise<string> {
  return withTx(async (c) => {
    const id = await insertSignalRow(c, {
      ...input,
      is_published: input.is_published ?? false,
      origin: input.origin ?? 'manual',
    });
    // A signal created already-published materializes its evidence immediately.
    if (input.is_published) await syncSignalEvidence(c, id, true);
    return id;
  });
}

// Atomic "create draft + claim the candidate" for the pipeline. Inserts the unpublished
// draft and links it to the candidate in ONE transaction, with the candidate row locked
// (`for update`) and the claim guarded by `signal_id is null`. So a retried OR concurrent
// analyze call can never produce a duplicate draft: the loser sees the candidate already
// claimed and returns null (its own insert rolls back). Returns the new signal id, or null.
// Candidate↔signal linking must always go through this function: a bare UPDATE of
// signal_candidates.signal_id would skip the lock, the analysis_status write, and the
// duplicate-draft guard.
export async function createDraftForCandidate(
  input: SignalInput & { origin?: SignalOrigin },
  candidateId: string
): Promise<string | null> {
  return withTx(async (c) => {
    const claim = await c.query(
      `select signal_id from signal_candidates where id = $1 for update`,
      [candidateId]
    );
    if (!claim.rowCount || (claim.rows[0] as { signal_id: string | null }).signal_id) {
      return null; // candidate gone, or already drafted by an earlier/concurrent call
    }
    // Always a draft (is_published=false) — publishing is the human gate, same as the manual path.
    const id = await insertSignalRow(c, { ...input, is_published: false, origin: input.origin ?? 'pipeline' });
    // Claim the candidate AND record the analysis outcome in the same locked transaction,
    // so a draft and its 'drafted' status can never disagree (migration 0007).
    await c.query(
      `update signal_candidates
          set signal_id = $1, analysis_status = 'drafted', analysis_error = null, updated_at = now()
        where id = $2`,
      [id, candidateId]
    );
    return id;
  });
}

// Seed ONE manual source as a candidate so it runs the SAME triage -> analyze -> draft path as
// discovery. raw_content is the source's curated text (so analysis does no web fetch); source_id
// links the existing source (preserving its author/outlet/reliability_prior); triage_status starts
// 'pending' so full triage still runs (the admin can override a rejection).
export async function createSourceCandidate(input: {
  runId: string;
  sourceId: string;
  url: string;
  headline?: string | null;
  source_domain?: string | null;
  lens: SignalLens;
  published_date?: string | null;
  raw_content: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into signal_candidates
       (run_id, source_id, url, headline, source_domain, lens, published_date, raw_content)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8) returning id`,
    [
      input.runId,
      input.sourceId,
      input.url,
      input.headline || null,
      input.source_domain || null,
      input.lens,
      input.published_date || null,
      input.raw_content,
    ]
  );
  return row!.id;
}

export async function updateSignal(id: string, input: SignalInput): Promise<void> {
  await withTx(async (c) => {
    await c.query(
      `update signals set
         title = $1, summary = $2, significance = $3,
         lenses = $4::signal_lens_t[], claim_touches = $5::text[], touch_details = $6::jsonb,
         source_id = $7, published_at = coalesce($8::timestamptz, published_at),
         updated_at = now()
       where id = $9`,
      [
        input.title,
        input.summary || null,
        input.significance,
        input.lenses,
        input.claim_touches,
        JSON.stringify(input.touch_details ?? {}),
        input.source_id || null,
        input.published_at || null,
        id,
      ]
    );
    // If the signal is live, re-sync its evidence (touches/direction may have changed).
    const pub = (await c.query(`select is_published from signals where id = $1`, [id]))
      .rows[0] as { is_published: boolean } | undefined;
    if (pub?.is_published) await syncSignalEvidence(c, id, true);
  });
}

// Visibility gate + the evidence commit: publishing materializes a signal's evidence
// into the map; unpublishing removes it. The editorial date (published_at) is untouched.
// Publishing also clears archived_at (a published signal is never an archived draft).
export async function setSignalPublished(id: string, published: boolean): Promise<void> {
  await withTx(async (c) => {
    await c.query(
      `update signals set is_published = $1,
              archived_at = case when $1 then null else archived_at end,
              updated_at = now()
        where id = $2`,
      [published, id]
    );
    await syncSignalEvidence(c, id, published);
  });
}

// Archive / unarchive a DRAFT — set it aside (out of the active queue + dedupe) without
// deleting, or restore it. Archiving only applies to unpublished signals (a published one
// isn't a draft sitting in the queue); the is_published=false guard makes that explicit.
export async function setSignalArchived(id: string, archived: boolean): Promise<void> {
  if (archived) {
    await exec(
      `update signals set archived_at = now(), updated_at = now() where id = $1 and is_published = false`,
      [id]
    );
  } else {
    // Symmetric is_published=false guard (defense-in-depth): a published signal never carries
    // archived_at, so unarchiving one is a no-op either way, but keep the invariant explicit.
    await exec(`update signals set archived_at = null, updated_at = now() where id = $1 and is_published = false`, [id]);
  }
}

export async function deleteSignal(id: string): Promise<void> {
  await exec(`delete from signals where id = $1`, [id]);
}

// ---- Draft-queue dedupe (manual consolidate / discard) ---------------------

// Consolidate a group of duplicate DRAFT signals into the canonical one: union the
// argument-map footprint (claim_touches + touch_details + lenses), widen significance to the
// group max, and APPEND the discarded sources' URLs to the canonical summary so the kept
// record shows every link that reported the same story. Then delete the duplicates and
// terminalize their pipeline candidates so they don't re-queue. Drafts only (unpublished):
// no evidence to unwind (syncSignalEvidence runs on publish), so a plain delete is safe.
// Returns the distinct run ids whose candidate tallies the caller should recompute.
export async function mergeDraftSignals(canonicalId: string, duplicateIds: string[]): Promise<string[]> {
  const dupes = Array.from(new Set(duplicateIds.filter((id) => id && id !== canonicalId)));
  if (!dupes.length) return [];
  const SIG_RANK: Record<Significance, number> = { low: 0, medium: 1, high: 2 };
  return withTx(async (c) => {
    // Lock the canonical + duplicates together (merge is a draft-stage op).
    const rowsRes = await c.query(
      `select id, summary, significance, lenses::text[] as lenses, claim_touches, touch_details, is_published
         from signals where id = any($1::uuid[]) for update`,
      [[canonicalId, ...dupes]]
    );
    const rows = rowsRes.rows as {
      id: string; summary: string | null; significance: Significance;
      lenses: SignalLens[]; claim_touches: string[];
      touch_details: Record<string, { direction: Direction; reason: string }> | null;
      is_published: boolean;
    }[];
    const canonical = rows.find((r) => r.id === canonicalId);
    if (!canonical || canonical.is_published) return [];           // never merge into a live signal
    const dupRows = rows.filter((r) => r.id !== canonicalId && !r.is_published);
    if (!dupRows.length) return [];

    // Union claim_touches + lenses; merge touch_details (canonical wins on key conflicts);
    // widen significance to the group max.
    const touches = new Set(canonical.claim_touches);
    const lenses = new Set(canonical.lenses);
    const details: Record<string, { direction: Direction; reason: string }> = { ...(canonical.touch_details ?? {}) };
    let significance = canonical.significance;
    for (const d of dupRows) {
      d.claim_touches.forEach((t) => touches.add(t));
      d.lenses.forEach((l) => lenses.add(l));
      for (const [code, det] of Object.entries(d.touch_details ?? {})) {
        if (!(code in details)) details[code] = det;               // canonical wins
      }
      if (SIG_RANK[d.significance] > SIG_RANK[significance]) significance = d.significance;
    }

    // Append the discarded sources' URLs to the canonical summary — every link that reported
    // the same story, kept on the surviving record.
    const urlRes = await c.query(
      `select src.url from signals s join sources src on src.id = s.source_id
        where s.id = any($1::uuid[]) and src.url is not null`,
      [dupes]
    );
    const urls = Array.from(new Set((urlRes.rows as { url: string }[]).map((r) => r.url).filter(Boolean)));
    let summary = canonical.summary ?? '';
    if (urls.length) {
      const block = `Also reported by: ${urls.join(' · ')}`;
      summary = summary ? `${summary}\n\n${block}` : block;
    }

    await c.query(
      `update signals set
         summary = $1, significance = $2,
         lenses = $3::signal_lens_t[], claim_touches = $4::text[], touch_details = $5::jsonb,
         updated_at = now()
       where id = $6`,
      [summary || null, significance, Array.from(lenses), Array.from(touches), JSON.stringify(details), canonicalId]
    );

    // Capture the affected runs BEFORE the delete NULLs signal_id, so the caller can refresh
    // their tallies. Then terminalize the duplicates' candidates (triage 'rejected' is what
    // keeps them out of the pending-analysis set — mirrors markCandidateUnanalyzable) and
    // delete the duplicate drafts.
    const runRes = await c.query(
      `select distinct run_id from signal_candidates where signal_id = any($1::uuid[])`,
      [dupes]
    );
    const runIds = (runRes.rows as { run_id: string }[]).map((r) => r.run_id);
    await c.query(
      `update signal_candidates
          set triage_status = 'rejected', triage_reason = 'merged into duplicate',
              analysis_status = 'discarded', analysis_error = 'merged into duplicate', updated_at = now()
        where signal_id = any($1::uuid[])`,
      [dupes]
    );
    await c.query(`delete from signals where id = any($1::uuid[])`, [dupes]);
    return runIds;
  });
}

// Persist (or clear) the latest board-level dedupe scan so the review survives a refresh.
// Singleton row (id = true). An empty recommendation clears it.
export async function saveDedupeScan(rec: DedupeRecommendation | null): Promise<void> {
  if (!rec || !rec.groups.length) {
    await exec(`delete from dedupe_scan where id = true`, []);
    return;
  }
  await exec(
    `insert into dedupe_scan (id, recommendation, generated_at)
     values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify(rec)]
  );
}

// Discard a single unpublished draft: terminalize its candidate so it won't re-queue, then
// delete it. Refuses to touch a published signal. Returns the affected run ids (0 or 1).
export async function discardDraftSignal(signalId: string): Promise<string[]> {
  return withTx(async (c) => {
    const row = (await c.query(`select is_published from signals where id = $1 for update`, [signalId]))
      .rows[0] as { is_published: boolean } | undefined;
    if (!row || row.is_published) return [];
    const runRes = await c.query(
      `select distinct run_id from signal_candidates where signal_id = $1`,
      [signalId]
    );
    const runIds = (runRes.rows as { run_id: string }[]).map((r) => r.run_id);
    // triage_status='rejected' (not just analysis_status) is what keeps the freed candidate
    // out of the pending-analysis set after its signal_id NULLs on delete.
    await c.query(
      `update signal_candidates
          set triage_status = 'rejected', triage_reason = 'discarded in dedupe review',
              analysis_status = 'discarded', analysis_error = 'discarded in dedupe review', updated_at = now()
        where signal_id = $1`,
      [signalId]
    );
    await c.query(`delete from signals where id = $1`, [signalId]);
    return runIds;
  });
}

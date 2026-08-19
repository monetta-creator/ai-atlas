import { q, one, exec, withTx } from './db';
import type { PoolClient } from 'pg';
import type {
  Direction, Weight, Dossier, QuestionSummary, SummaryMetrics, Significance, SignalLens,
  SignalOrigin, RunCadence, RunStatus, RunStep, TriageStatus, AnalysisStatus, DedupeRecommendation,
  Report, ConceptGapScan, Domain, Resolvability, Relation, ArgumentGapScan,
  SignalBrief, SignalCounterpoint,
  PaperTriageStatus, PaperReviewStatus, ResearchStep, PaperExtraction, ThreadRelation,
  ThreadStatus, ResearchThreadScan,
  CompanyStatus, CompanyStage, CompanyEventKind, ScoutVerdict, ScoutScores,
} from './types';
import { sanitizeText, domainOf } from './pipeline/web';
import { companyNameKey, parseStageHint, parseFoundedHint, mergeDossier } from './scout/core';
import type { ScoutDossier } from './scout/core';
import type { RawCandidate } from './pipeline/web';
import type { ArxivEntry } from './research/arxiv';
import type { RiskLevel } from './supply-chain/map';

// All writes go through here (server-only). The guarded server actions in
// lib/actions.ts are the only callers, and every one re-checks isAdmin first.

export async function createSource(input: {
  title?: string;
  author?: string;
  outlet?: string;
  url?: string;
  published_at?: string;
  raw_text?: string;
  domain_tag?: string | null;
  reliability_prior?: number | null;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into sources (title, author, outlet, url, published_at, raw_text, domain_tag, reliability_prior)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      input.title || null,
      input.author || null,
      input.outlet || null,
      input.url || null,
      input.published_at || null,
      input.raw_text || null,
      input.domain_tag || null,
      input.reliability_prior ?? null,
    ]
  );
  return row!.id;
}

export async function setReliabilityPrior(sourceId: string, prior: number | null): Promise<void> {
  await exec(`update sources set reliability_prior = $1 where id = $2`, [prior, sourceId]);
}

// Editable site-text overrides (see lib/content.ts). Upsert by key.
export async function saveContentOverride(key: string, value: string): Promise<void> {
  await exec(
    `insert into content_blocks (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value]
  );
}

export async function resetContentOverride(key: string): Promise<void> {
  await exec(`delete from content_blocks where key = $1`, [key]);
}

export async function setDossier(sourceId: string, dossier: Dossier): Promise<void> {
  await exec(`update sources set dossier = $1::jsonb, updated_at = now() where id = $2`, [
    JSON.stringify(dossier),
    sourceId,
  ]);
}

// Cache the AI briefing + counterpoint onto a signal (migration 0022). Written in one shot
// from a single generation; updateSignal never touches these columns, so editing a signal
// preserves a cached analysis (the admin regenerates if it drifts). Mirrors setDossier.
export async function setSignalAnalysis(
  signalId: string, brief: SignalBrief, counterpoint: SignalCounterpoint
): Promise<void> {
  await exec(
    `update signals set brief = $1::jsonb, counterpoint = $2::jsonb, updated_at = now() where id = $3`,
    [JSON.stringify(brief), JSON.stringify(counterpoint), signalId]
  );
}

// Attach one source as evidence to many targets at once (Change 3), atomic.
export async function addEvidenceMany(
  items: {
    source_id: string;
    target_type: 'claim' | 'bridge_claim';
    target_id: string;
    direction: Direction;
    weight: Weight;
    excerpt?: string;
    note?: string;
  }[]
): Promise<void> {
  if (!items.length) return;
  await withTx(async (c) => {
    for (const it of items) {
      await c.query(
        `insert into evidence (source_id, target_type, target_id, direction, weight, excerpt, note)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [it.source_id, it.target_type, it.target_id, it.direction, it.weight, it.excerpt || null, it.note || null]
      );
    }
  });
}

// Delete a source entirely (Change 4). Its evidence rows cascade
// (evidence.source_id ... on delete cascade), and rationales.evidence_id is set null.
export async function deleteSource(sourceId: string): Promise<void> {
  await exec(`delete from sources where id = $1`, [sourceId]);
}

// Repoint one evidence link to a different claim/bridge (Change 4).
export async function reassignEvidence(
  evidenceId: string,
  targetType: 'claim' | 'bridge_claim',
  targetId: string
): Promise<void> {
  await exec(`update evidence set target_type = $1, target_id = $2, updated_at = now() where id = $3`, [
    targetType,
    targetId,
    evidenceId,
  ]);
}

export async function deleteEvidence(evidenceId: string): Promise<void> {
  await exec(`delete from evidence where id = $1`, [evidenceId]);
}

// Append a question state summary to the per-question log.
export async function createQuestionSummary(
  questionId: string,
  summary: QuestionSummary,
  metrics: SummaryMetrics
): Promise<void> {
  await exec(
    `insert into question_summaries (question_id, summary, metrics) values ($1, $2::jsonb, $3::jsonb)`,
    [questionId, JSON.stringify(summary), JSON.stringify(metrics)]
  );
}

export async function addEvidence(input: {
  source_id: string;
  target_type: 'claim' | 'bridge_claim';
  target_id: string;
  direction: Direction;
  weight: Weight;
  excerpt?: string;
  note?: string;
}): Promise<void> {
  await exec(
    `insert into evidence (source_id, target_type, target_id, direction, weight, excerpt, note)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.source_id,
      input.target_type,
      input.target_id,
      input.direction,
      input.weight,
      input.excerpt || null,
      input.note || null,
    ]
  );
}

const CONF_TABLE: Record<string, string> = {
  claim: 'claims',
  bridge_claim: 'bridge_claims',
  stance: 'stances',
  position: 'positions_crosscutting',
};

// The human gate: move a confidence AND record why AND snapshot — all atomic.
// If any step fails, the whole thing rolls back, so a confidence can never move
// without its rationale.
export async function moveConfidence(input: {
  target_type: 'claim' | 'bridge_claim' | 'stance' | 'position';
  target_id: string;
  new_confidence: number;
  reason: string;
  evidence_id?: string | null;
}): Promise<void> {
  const table = CONF_TABLE[input.target_type];
  if (!table) throw new Error('invalid target_type');

  await withTx(async (c) => {
    const cur = (await c.query(`select confidence from ${table} where id = $1`, [input.target_id]))
      .rows[0] as { confidence: number | null } | undefined;
    if (!cur) throw new Error('target not found');

    await c.query(`update ${table} set confidence = $1 where id = $2`, [
      input.new_confidence,
      input.target_id,
    ]);
    await c.query(
      `insert into rationales (target_type, target_id, old_confidence, new_confidence, reason, evidence_id)
       values ($1,$2,$3,$4,$5,$6)`,
      [input.target_type, input.target_id, cur.confidence, input.new_confidence, input.reason, input.evidence_id || null]
    );
    await snapshotOnClient(c, 'post_commit');
  });
}

async function snapshotOnClient(
  c: PoolClient,
  trigger: 'manual' | 'post_commit' | 'scheduled'
): Promise<void> {
  const [claims, stances, bridges, positions] = await Promise.all([
    c.query(`select id, confidence from claims where is_frame = false`),
    c.query(`select id, confidence from stances`),
    c.query(`select id, confidence from bridge_claims`),
    c.query(`select id, confidence from positions_crosscutting`),
  ]);
  const state = {
    claims: Object.fromEntries(claims.rows.map((r) => [r.id, r.confidence])),
    stances: Object.fromEntries(stances.rows.map((r) => [r.id, r.confidence])),
    bridge_claims: Object.fromEntries(bridges.rows.map((r) => [r.id, r.confidence])),
    positions: Object.fromEntries(positions.rows.map((r) => [r.id, r.confidence])),
  };
  await c.query(`insert into snapshots (state, trigger) values ($1,$2)`, [
    JSON.stringify(state),
    trigger,
  ]);
}

export async function takeSnapshot(
  trigger: 'manual' | 'post_commit' | 'scheduled' = 'manual'
): Promise<void> {
  await withTx((c) => snapshotOnClient(c, trigger));
}

// ---- Cross-cutting positions (the worldview layer; personal, §3.3) ----
// A position is a 1-2 sentence spanning view, linked to the stances/claims/bridges
// across questions that compose it. Confidence starts NULL (unset) and only moves
// through the rationale-gated moveConfidence (target_type 'position').
export async function createPosition(statement: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into positions_crosscutting (statement) values ($1) returning id`,
    [statement]
  );
  return row!.id;
}

export async function updatePositionStatement(id: string, statement: string): Promise<void> {
  await exec(`update positions_crosscutting set statement = $1 where id = $2`, [statement, id]);
}

export async function deletePosition(id: string): Promise<void> {
  await exec(`delete from positions_crosscutting where id = $1`, [id]);
}

export async function addPositionComponent(
  positionId: string,
  targetType: 'stance' | 'claim' | 'bridge_claim',
  targetId: string
): Promise<void> {
  await exec(
    `insert into position_components (position_id, target_type, target_id) values ($1,$2,$3)`,
    [positionId, targetType, targetId]
  );
}

export async function removePositionComponent(componentId: string): Promise<void> {
  await exec(`delete from position_components where id = $1`, [componentId]);
}

// ---- Lens tagging (node_lenses; the cross-cutting angles) ----
export async function addNodeLens(
  targetType: 'stance' | 'claim' | 'bridge_claim',
  targetId: string,
  lens: string
): Promise<void> {
  await exec(
    `insert into node_lenses (target_type, target_id, lens) values ($1,$2,$3)
     on conflict (target_type, target_id, lens) do nothing`,
    [targetType, targetId, lens]
  );
}

export async function removeNodeLens(
  targetType: 'stance' | 'claim' | 'bridge_claim',
  targetId: string,
  lens: string
): Promise<void> {
  await exec(
    `delete from node_lenses where target_type = $1 and target_id = $2 and lens = $3`,
    [targetType, targetId, lens]
  );
}

// ---- Direct domain-text edits (the /data editor) ----
// The ONLY columns the data editor may write. Prose only: confidence (the human
// gate), enums, booleans, and code/slug are absent by construction, so they are
// unreachable through this path. Table and column names cannot be parameterized,
// so they are validated against this registry (a fixed set of string literals)
// before interpolation; value and id are always parameterized.
type FieldSpec = { required?: boolean; frameAware?: boolean };
export const DOMAIN_FIELDS: Record<string, Record<string, FieldSpec>> = {
  questions: { title: { required: true }, summary: {} },
  stances: { title: { required: true }, holder: {}, summary: {}, test: { required: true } },
  claims: { statement: { required: true }, test: { frameAware: true }, domain_note: {} },
  bridge_claims: { statement: { required: true }, test: { required: true }, note: {} },
};

export function isEditableDomainField(table: string, column: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(DOMAIN_FIELDS, table) &&
    Object.prototype.hasOwnProperty.call(DOMAIN_FIELDS[table], column)
  );
}

export async function updateDomainField(
  table: string,
  id: string,
  column: string,
  value: string
): Promise<void> {
  if (!isEditableDomainField(table, column)) throw new Error('Field not editable.');
  const spec = DOMAIN_FIELDS[table][column];
  const trimmed = value.trim();

  // claims.test is required only when the claim is not a frame (CHECK
  // claims_test_required). Read is_frame in-transaction so the rule sits with the
  // write, the way moveConfidence reads the current confidence before updating.
  if (spec.frameAware) {
    await withTx(async (c) => {
      const row = (await c.query(`select is_frame from claims where id = $1`, [id]))
        .rows[0] as { is_frame: boolean } | undefined;
      if (!row) throw new Error('Record not found.');
      if (!row.is_frame && trimmed === '') throw new Error('A test is required for a non-frame claim.');
      await c.query(`update claims set test = $1 where id = $2`, [trimmed === '' ? null : trimmed, id]);
    });
    return;
  }

  if (spec.required && trimmed === '') throw new Error('This field is required.');
  const final = !spec.required && trimmed === '' ? null : trimmed; // nullable empties become NULL
  // table and column are registry-validated literals; value and id are parameterized.
  await exec(`update ${table} set ${column} = $1 where id = $2`, [final, id]);
}

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
         (title, summary, significance, lenses, claim_touches, touch_details, source_id, published_at, is_published, origin)
       values ($1, $2, $3, $4::signal_lens_t[], $5::text[], $6::jsonb, $7, coalesce($8::timestamptz, now()), $9, $10)
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

export async function attachSignalToCandidate(candidateId: string, signalId: string): Promise<void> {
  await exec(`update signal_candidates set signal_id = $1, updated_at = now() where id = $2`, [signalId, candidateId]);
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

// ---- Saved reports (persistence) -------------------------------------------
// Upsert: with an id, update in place (updated_at bumped by the trigger); else insert.
// The full Report is stored as jsonb; metadata columns mirror it for the list view. The
// caller (saveReportAction) sanitizes the narrative HTML before this writes.
export async function saveReport(input: { id?: string; title: string; report: Report }): Promise<string> {
  const { id, title, report } = input;
  const json = JSON.stringify(report);
  if (id) {
    await exec(
      `update reports set title = $2, date_from = $3::date, date_to = $4::date,
              lenses = $5::signal_lens_t[], generated_at = $6::timestamptz, data = $7::jsonb
        where id = $1`,
      [id, title, report.range.from, report.range.to, report.lenses, report.generatedAt, json]
    );
    return id;
  }
  const row = await one<{ id: string }>(
    `insert into reports (title, date_from, date_to, lenses, generated_at, data)
       values ($1, $2::date, $3::date, $4::signal_lens_t[], $5::timestamptz, $6::jsonb)
     returning id`,
    [title, report.range.from, report.range.to, report.lenses, report.generatedAt, json]
  );
  return row!.id;
}

export async function deleteReport(id: string): Promise<void> {
  await exec(`delete from reports where id = $1`, [id]);
}

// ---- AI rate cards (cost monitoring; migration 0014) -----------------------
// Append-only pricing history: a price change is a NEW card, never an edit. One card per
// (model, effective_date) — the unique constraint rejects a duplicate effective date for a
// model (surfaced to the admin as a friendly error in addRateCardAction). Returns the new id.
export async function addRateCard(input: {
  model: string;
  effective_date: string;            // 'YYYY-MM-DD'
  input_per_mtok: number;
  output_per_mtok: number;
  cache_write_per_mtok: number;
  cache_read_per_mtok: number;
  context_window: number;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into ai_rate_cards
       (model, effective_date, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok, context_window)
     values ($1, $2::date, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.model,
      input.effective_date,
      input.input_per_mtok,
      input.output_per_mtok,
      input.cache_write_per_mtok,
      input.cache_read_per_mtok,
      input.context_window,
    ]
  );
  return row!.id;
}

// ---- Concepts (the semantic scaffold; migration 0017) -----------------------
// The AI only ever recommends prerequisite edges and claim links back to the
// client; these writers receive what the admin confirmed and write it as
// status='confirmed'. Links are replaced wholesale inside the transaction so the
// form's state is the single source of truth for a concept's wiring.

export interface ConceptWrite {
  slug: string;
  name: string;
  short_definition: string;
  explanation: string | null;
  status: 'settled' | 'contested';
  prerequisite_ids: string[];
  claim_links: { target_type: 'claim' | 'bridge_claim'; target_code: string }[];
}

// Walk the dependency graph upward from the concept's NEW prerequisites; if the
// walk reaches the concept itself, the new set would close a cycle (the layered
// /concepts layout needs a DAG). Runs on the transaction's client so the check
// and the write are atomic — a concurrent edit can't sneak a cycle in between.
async function assertConceptAcyclic(
  c: PoolClient, conceptId: string, prereqIds: string[]
): Promise<void> {
  if (!prereqIds.length) return;
  const rows = (await c.query(`select concept_id, prerequisite_id from concept_edges`))
    .rows as { concept_id: string; prerequisite_id: string }[];
  const prereqsOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.concept_id === conceptId) continue; // being replaced by the new set
    const list = prereqsOf.get(r.concept_id) ?? [];
    list.push(r.prerequisite_id);
    prereqsOf.set(r.concept_id, list);
  }
  const seen = new Set<string>();
  const stack = [...prereqIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === conceptId) {
      throw new Error('That prerequisite set would create a dependency cycle.');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of prereqsOf.get(id) ?? []) stack.push(p);
  }
}

// Replace a concept's edges + claim links with the admin-confirmed sets.
async function writeConceptLinks(
  c: PoolClient, conceptId: string, input: ConceptWrite
): Promise<void> {
  await c.query(`delete from concept_edges where concept_id = $1`, [conceptId]);
  for (const pid of input.prerequisite_ids) {
    await c.query(
      `insert into concept_edges (concept_id, prerequisite_id, status)
       values ($1, $2, 'confirmed') on conflict do nothing`,
      [conceptId, pid]
    );
  }
  await c.query(`delete from concept_claims where concept_id = $1`, [conceptId]);
  for (const l of input.claim_links) {
    await c.query(
      `insert into concept_claims (concept_id, target_type, target_code, status)
       values ($1, $2, $3, 'confirmed') on conflict do nothing`,
      [conceptId, l.target_type, l.target_code]
    );
  }
}

export async function createConcept(input: ConceptWrite): Promise<string> {
  return withTx(async (c) => {
    const row = (
      await c.query(
        `insert into concepts (slug, name, short_definition, explanation, status)
         values ($1, $2, $3, $4, $5) returning id`,
        [input.slug, input.name, input.short_definition, input.explanation, input.status]
      )
    ).rows[0] as { id: string };
    // A brand-new concept can't close a cycle (nothing depends on it yet), but the
    // shared guard keeps the invariant in one place.
    await assertConceptAcyclic(c, row.id, input.prerequisite_ids);
    await writeConceptLinks(c, row.id, input);
    return row.id;
  });
}

export async function updateConcept(id: string, input: ConceptWrite): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query(
      `update concepts set slug = $1, name = $2, short_definition = $3, explanation = $4, status = $5
        where id = $6`,
      [input.slug, input.name, input.short_definition, input.explanation, input.status, id]
    );
    if (!res.rowCount) throw new Error('Concept not found.');
    await assertConceptAcyclic(c, id, input.prerequisite_ids);
    await writeConceptLinks(c, id, input);
  });
}

// Edges and claim links cascade with the row.
export async function deleteConcept(id: string): Promise<void> {
  await exec(`delete from concepts where id = $1`, [id]);
}

// Persist (or clear) the latest concept gap scan so the review survives a refresh.
// Singleton row (id = true), mirroring saveDedupeScan. An empty scan clears it.
export async function saveConceptGapScan(scan: ConceptGapScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`delete from concept_gap_scan where id = true`, []);
    return;
  }
  await exec(
    `insert into concept_gap_scan (id, recommendation, generated_at)
     values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify(scan)]
  );
}

// ---- Argument-map node authoring (claims + bridges; migration 0021) ----------
// The genuinely new write surface: create a claim or bridge-claim AND its edges in
// ONE transaction, mirroring createConcept. Edges have NO foreign keys, so the
// writer resolves every endpoint code to a live id inside the transaction and
// REFUSES a dangling edge (the seed's integrity check, now at runtime). A new node
// starts at NEUTRAL confidence with no rationale (this is birth, not a move — the
// seed does the same); the first ConfidenceEditor move records the "why".
// confidence_label is a generated column; never write it.

const NEUTRAL_CONFIDENCE = 0.5;

export interface ClaimEdgeInput {
  target_type: 'stance' | 'bridge_claim';
  target_code: string;
  relation: Relation;          // supports | contradicts | depends_on (organizes is frame-only)
}

export interface CreateClaimInput {
  code: string;
  statement: string;
  test: string;
  domain: Domain;
  domain_note?: string | null;
  resolvability?: Resolvability | null;
  edges: ClaimEdgeInput[];     // claim -> stance / claim -> bridge_claim
}

// Resolve a set of codes within a table to their ids. Edges carry no FK, so this is
// the integrity gate: a caller iterates the result and throws on any unresolved code.
async function resolveCodes(
  c: PoolClient, table: 'stances' | 'claims' | 'bridge_claims', codes: string[]
): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = (await c.query(`select id, code from ${table} where code = any($1)`, [codes]))
    .rows as { id: string; code: string }[];
  return new Map(rows.map((r) => [r.code, r.id]));
}

export async function createClaimWithEdges(input: CreateClaimInput): Promise<{ id: string; code: string }> {
  return withTx(async (c) => {
    const row = (
      await c.query(
        `insert into claims (code, statement, test, domain, domain_note, resolvability, confidence, is_frame, reflexive)
         values ($1, $2, $3, $4, $5, $6, $7, false, false) returning id, code`,
        [
          input.code, input.statement, input.test, input.domain,
          input.domain_note || null, input.resolvability || null, NEUTRAL_CONFIDENCE,
        ]
      )
    ).rows[0] as { id: string; code: string };

    const stanceCodes = input.edges.filter((e) => e.target_type === 'stance').map((e) => e.target_code);
    const bridgeCodes = input.edges.filter((e) => e.target_type === 'bridge_claim').map((e) => e.target_code);
    const stanceIds = await resolveCodes(c, 'stances', stanceCodes);
    const bridgeIds = await resolveCodes(c, 'bridge_claims', bridgeCodes);

    for (const e of input.edges) {
      const toId = e.target_type === 'stance' ? stanceIds.get(e.target_code) : bridgeIds.get(e.target_code);
      if (!toId) throw new Error(`Edge endpoint not found: ${e.target_type}:${e.target_code}`);
      await c.query(
        `insert into edges (from_type, from_id, to_type, to_id, relation)
         values ('claim', $1, $2, $3, $4)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
        [row.id, e.target_type, toId, e.relation]
      );
    }
    return row;
  });
}

export interface BridgeFeedInput { claim_code: string; relation: Relation; }  // claim -> bridge

export interface CreateBridgeInput {
  code: string;
  statement: string;
  domain_from: Domain;
  domain_to: Domain;
  test: string;
  resolvability?: Resolvability | null;
  note?: string | null;
  feeders: BridgeFeedInput[];  // claims that feed this bridge (claim -> bridge_claim)
}

export async function createBridgeWithEdges(input: CreateBridgeInput): Promise<{ id: string; code: string }> {
  return withTx(async (c) => {
    const row = (
      await c.query(
        `insert into bridge_claims (code, statement, domain_from, domain_to, test, resolvability, confidence, reflexive, note)
         values ($1, $2, $3, $4, $5, $6, $7, false, $8) returning id, code`,
        [
          input.code, input.statement, input.domain_from, input.domain_to, input.test,
          input.resolvability || null, NEUTRAL_CONFIDENCE, input.note || null,
        ]
      )
    ).rows[0] as { id: string; code: string };

    const claimIds = await resolveCodes(c, 'claims', input.feeders.map((f) => f.claim_code));
    for (const f of input.feeders) {
      const fromId = claimIds.get(f.claim_code);
      if (!fromId) throw new Error(`Feeding claim not found: ${f.claim_code}`);
      await c.query(
        `insert into edges (from_type, from_id, to_type, to_id, relation)
         values ('claim', $1, 'bridge_claim', $2, $3)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
        [fromId, row.id, f.relation]
      );
    }
    return row;
  });
}

// Persist (or clear) the latest argument-map gap scan (singleton, mirrors saveConceptGapScan).
export async function saveArgumentGapScan(scan: ArgumentGapScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`delete from argument_gap_scan where id = true`, []);
    return;
  }
  await exec(
    `insert into argument_gap_scan (id, recommendation, generated_at)
     values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify(scan)]
  );
}

// ---- Supply chain overlay (the /supply-chain admin layer) -------------------
// The map structure lives in lib/supply-chain/map.ts; these write only the mutable
// overlay (per-node risk + note) and the node -> signal links, keyed by slug.

export async function setSupplyChainNodeMeta(
  slug: string,
  input: { risk_level: RiskLevel | null; admin_note: string | null }
): Promise<void> {
  await exec(
    `insert into supply_chain_node_meta (slug, risk_level, admin_note)
     values ($1, $2, $3)
     on conflict (slug) do update
        set risk_level = excluded.risk_level,
            admin_note = excluded.admin_note,
            updated_at = now()`,
    [slug, input.risk_level, input.admin_note]
  );
}

export async function linkSignalToNode(slug: string, signalId: string): Promise<void> {
  await exec(
    `insert into supply_chain_node_signals (node_slug, signal_id)
     values ($1, $2)
     on conflict (node_slug, signal_id) do nothing`,
    [slug, signalId]
  );
}

export async function unlinkSignalFromNode(slug: string, signalId: string): Promise<void> {
  await exec(
    `delete from supply_chain_node_signals where node_slug = $1 and signal_id = $2`,
    [slug, signalId]
  );
}

// ---- Research section (migration 0023) ---------------------------------------

export async function createResearchRun(sinceISO: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into research_runs (since_date, status, step) values ($1::date, 'running', 'pull') returning id`,
    [sinceISO]
  );
  return row!.id;
}

export async function updateResearchRun(
  id: string,
  fields: Partial<{ status: RunStatus; step: ResearchStep; error: string | null }>
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status !== undefined) { params.push(fields.status); sets.push(`status = $${params.length}`); }
  if (fields.step !== undefined) { params.push(fields.step); sets.push(`step = $${params.length}`); }
  if (fields.error !== undefined) { params.push(fields.error); sets.push(`error = $${params.length}`); }
  if (!sets.length) return;
  params.push(id);
  await exec(`update research_runs set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

// Pull-step tallies are increments (one page per call); triage tallies are recomputed
// from the papers themselves (recomputeResearchRunCounts) so re-runs stay honest.
export async function bumpResearchPullCounts(id: string, scanned: number, inserted: number): Promise<void> {
  await exec(
    `update research_runs
        set scanned_count = scanned_count + $1, pulled_count = pulled_count + $2, updated_at = now()
      where id = $3`,
    [scanned, inserted, id]
  );
}

export async function recomputeResearchRunCounts(id: string): Promise<void> {
  await exec(
    `update research_runs r set
       kept_count     = (select count(*) from papers p where p.run_id = r.id and p.triage_status = 'kept'),
       rejected_count = (select count(*) from papers p where p.run_id = r.id and p.triage_status = 'rejected'),
       updated_at = now()
     where r.id = $1`,
    [id]
  );
}

// Bulk-upsert one pulled page. On conflict (a paper already in the library from a prior
// run, a manual add, or a revision bubbling up the sort) refresh the arXiv metadata but
// NEVER touch funnel or review state — triage decisions and the personal layer survive
// re-pulls. Returns how many rows were actually new.
export async function upsertArxivPapers(runId: string, entries: ArxivEntry[]): Promise<number> {
  if (!entries.length) return 0;
  let inserted = 0;
  await withTx(async (c) => {
    for (const e of entries) {
      const res = await c.query(
        `insert into papers
           (origin, arxiv_id, url, run_id, title, abstract, authors, categories, comments,
            arxiv_version, published_at, arxiv_updated)
         values ('arxiv', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, nullif($10,'')::date, nullif($11,'')::date)
         on conflict (arxiv_id) do update set
           title = excluded.title, abstract = excluded.abstract, authors = excluded.authors,
           categories = excluded.categories, comments = excluded.comments,
           arxiv_version = excluded.arxiv_version, arxiv_updated = excluded.arxiv_updated,
           updated_at = now()
         returning (xmax = 0) as is_new`,
        [
          e.arxiv_id, e.url, runId, sanitizeText(e.title), sanitizeText(e.abstract),
          JSON.stringify(e.authors), e.categories, e.comment ? sanitizeText(e.comment) : null,
          e.version, e.published, e.updated,
        ]
      );
      if ((res.rows[0] as { is_new: boolean } | undefined)?.is_new) inserted++;
    }
  });
  return inserted;
}

export async function setPaperTriage(
  paperId: string,
  status: PaperTriageStatus,
  reason: string | null,
  suggestions?: { claim_touches: string[]; suggested_concepts: string[]; suggested_threads: string[] },
  summary?: string | null
): Promise<void> {
  await exec(
    `update papers
        set triage_status = $1, triage_reason = $2,
            triage_summary = coalesce($3, triage_summary),
            claim_touches = coalesce($4, claim_touches),
            suggested_concepts = coalesce($5, suggested_concepts),
            suggested_threads = coalesce($6, suggested_threads),
            updated_at = now()
      where id = $7`,
    [
      status, reason,
      summary ?? null,
      suggestions?.claim_touches ?? null,
      suggestions?.suggested_concepts ?? null,
      suggestions?.suggested_threads ?? null,
      paperId,
    ]
  );
}

// The review decision + its why (the human gate on the research funnel). Tracking
// requires a note — enforced in the action; this just writes.
export async function setPaperReview(paperId: string, status: PaperReviewStatus, note: string | null): Promise<void> {
  await exec(
    `update papers set review_status = $1, review_note = $2, reviewed_at = now(), updated_at = now() where id = $3`,
    [status, note, paperId]
  );
}

// Manual "Add paper": insert as pre-approved (triage 'kept' — human before the expensive
// call). Dedup on arxiv_id/url returns the existing row instead of duplicating; existed
// lets the action route the admin to what is already there.
export async function createManualPaper(input: {
  arxiv_id?: string | null;
  url: string;
  title: string;
  abstract?: string | null;
  authors?: string[];
  categories?: string[];
  comments?: string | null;
  published_at?: string | null; // YYYY-MM-DD
  arxiv_version?: number | null;
  arxiv_updated?: string | null;
  source_id?: string | null;
  raw_content?: string | null;  // pre-hydrated text (the "Send to research" path)
  fetched_via?: string | null;
  rigor_prior?: number | null;  // seeded from the source's reliability prior
}): Promise<{ id: string; existed: boolean }> {
  const existing = await one<{ id: string }>(
    `select id from papers where url = $1 or (arxiv_id is not null and arxiv_id = $2) limit 1`,
    [input.url, input.arxiv_id ?? null]
  );
  if (existing) {
    // Backfill the source link when the paper was already in the library (e.g. pulled
    // from arXiv earlier, now sent over from its curated source page).
    if (input.source_id) {
      await exec(`update papers set source_id = coalesce(source_id, $1), updated_at = now() where id = $2`, [input.source_id, existing.id]);
    }
    return { id: existing.id, existed: true };
  }
  const row = await one<{ id: string }>(
    `insert into papers
       (origin, arxiv_id, url, source_id, title, abstract, authors, categories, comments,
        arxiv_version, published_at, arxiv_updated, triage_status, triage_reason)
     values ('manual', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
             nullif($10,'')::date, nullif($11,'')::date, 'kept', 'added by the admin')
     returning id`,
    [
      input.arxiv_id ?? null, input.url, input.source_id ?? null,
      sanitizeText(input.title), input.abstract ? sanitizeText(input.abstract) : null,
      JSON.stringify(input.authors ?? []), input.categories ?? [],
      input.comments ? sanitizeText(input.comments) : null,
      input.arxiv_version ?? null, input.published_at ?? '', input.arxiv_updated ?? '',
    ]
  );
  if (input.raw_content || input.rigor_prior != null) {
    await exec(
      `update papers set raw_content = coalesce($1, raw_content), fetched_via = coalesce($2, fetched_via),
              rigor_prior = coalesce($3, rigor_prior), updated_at = now()
        where id = $4`,
      [input.raw_content ? sanitizeText(input.raw_content) : null, input.fetched_via ?? null, input.rigor_prior ?? null, row!.id]
    );
  }
  return { id: row!.id, existed: false };
}

// Retention for triage rejects (docs/research-section.md): metadata rows are kept ~90
// days for the citation-velocity self-correction, then pruned. Opportunistic — called
// at run start, never from a cron. Guards keep anything referenced or human-touched.
export async function pruneRejectedPapers(days = 90): Promise<number> {
  return exec(
    `delete from papers
      where triage_status = 'rejected'
        and review_status = 'pending'
        and signal_id is null and source_id is null
        and created_at < now() - make_interval(days => $1)
        and not exists (select 1 from thread_papers tp where tp.paper_id = papers.id)
        and not exists (select 1 from paper_concepts pc where pc.paper_id = papers.id)`,
    [days]
  );
}

// Atomically claim one chunk of pending papers for triage, so CONCURRENT triage
// chunks (the console runs a small pool) never send the same paper to the model
// twice: the claim is a single statement with `for update skip locked`, and marks
// the rows via triage_reason. A claim expires after 5 minutes (updated_at), so a
// chunk that died mid-model-call self-heals on the next pass — its papers are
// still triage_status='pending' and get reclaimed.
export async function claimPendingPapers(
  runId: string, limit: number
): Promise<{ id: string; arxiv_id: string | null; title: string; abstract: string | null; categories: string[]; comments: string | null; published_at: string | null }[]> {
  const { rows } = await withTx(async (c) =>
    c.query(
      `update papers set triage_reason = 'in triage', updated_at = now()
        where id in (
          select id from papers
           where run_id = $1 and triage_status = 'pending'
             and (triage_reason is distinct from 'in triage' or updated_at < now() - interval '5 minutes')
           order by published_at desc nulls last, created_at
           limit $2
           for update skip locked)
        returning id, arxiv_id, title, abstract, categories, comments,
                  to_char(published_at, 'YYYY-MM-DD') as published_at`,
      [runId, limit]
    )
  );
  return rows as { id: string; arxiv_id: string | null; title: string; abstract: string | null; categories: string[]; comments: string | null; published_at: string | null }[];
}

// ---- Research phase 2: analysis cache, extraction, links, promotion ----------

export async function setPaperRawContent(paperId: string, text: string | null, via?: string | null): Promise<void> {
  const clean = text == null ? null : sanitizeText(text);
  await exec(
    `update papers set raw_content = $1, fetched_via = coalesce($2, fetched_via), updated_at = now() where id = $3`,
    [clean, via ?? null, paperId]
  );
}

// Persist the structured finding + refresh the advisory arrays (the full-text pass is
// more authoritative than triage's abstract-only guesses). Never touches rigor_prior.
export async function setPaperExtraction(
  paperId: string,
  extraction: PaperExtraction,
  suggestions: { claim_touches: string[]; suggested_concepts: string[]; suggested_threads: string[] }
): Promise<void> {
  await exec(
    `update papers set
       extraction = $1::jsonb, claim_touches = $2, suggested_concepts = $3, suggested_threads = $4,
       updated_at = now()
     where id = $5`,
    [
      JSON.stringify(extraction),
      suggestions.claim_touches, suggestions.suggested_concepts, suggestions.suggested_threads,
      paperId,
    ]
  );
}

// The human sets the rigor prior (the model only ever suggested one inside extraction).
export async function setPaperRigor(paperId: string, prior: number | null): Promise<void> {
  await exec(`update papers set rigor_prior = $1, updated_at = now() where id = $2`, [prior, paperId]);
}

export async function setPaperSource(paperId: string, sourceId: string): Promise<void> {
  await exec(`update papers set source_id = $1, updated_at = now() where id = $2`, [sourceId, paperId]);
}

// Promotion is additive: the paper stays in the research library; this link is the
// road a paper's findings take into the Argument Map (via the signal publish gate).
export async function setPaperSignal(paperId: string, signalId: string | null): Promise<void> {
  await exec(`update papers set signal_id = $1, updated_at = now() where id = $2`, [signalId, paperId]);
}

// Paper->concept and paper->thread links are human-committed ('confirmed') rows; the
// model's proposals live in the papers.suggested_* arrays until confirmed here.
export async function confirmPaperConcept(paperId: string, conceptSlug: string): Promise<void> {
  await exec(
    `insert into paper_concepts (paper_id, concept_slug, status) values ($1, $2, 'confirmed')
     on conflict (paper_id, concept_slug) do update set status = 'confirmed'`,
    [paperId, conceptSlug]
  );
}

export async function removePaperConcept(paperId: string, conceptSlug: string): Promise<void> {
  await exec(`delete from paper_concepts where paper_id = $1 and concept_slug = $2`, [paperId, conceptSlug]);
}

export async function placePaperInThread(
  paperId: string, threadSlug: string, relation: ThreadRelation, why: string | null
): Promise<void> {
  const thread = await one<{ id: string }>(`select id from research_threads where slug = $1`, [threadSlug]);
  if (!thread) throw new Error('Thread not found.');
  await exec(
    `insert into thread_papers (thread_id, paper_id, relation, why, status)
     values ($1, $2, $3, $4, 'confirmed')
     on conflict (thread_id, paper_id) do update set relation = excluded.relation, why = excluded.why, status = 'confirmed'`,
    [thread.id, paperId, relation, why]
  );
}

export async function removePaperFromThread(paperId: string, threadSlug: string): Promise<void> {
  await exec(
    `delete from thread_papers tp using research_threads t
      where tp.thread_id = t.id and t.slug = $1 and tp.paper_id = $2`,
    [threadSlug, paperId]
  );
}

// ---- Research phase 3: threads as living pages -------------------------------

// The synthesis write: update the living page AND preserve the prior discipline —
// every rewrite (including the first) lands in thread_revisions with what triggered
// it, atomically. The snapshots idea applied to prose.
export async function setThreadSynthesis(
  threadId: string, synthesisHtml: string, triggerNote: string | null
): Promise<void> {
  await withTx(async (c) => {
    await c.query(
      `update research_threads set synthesis = $1, updated_at = now() where id = $2`,
      [synthesisHtml, threadId]
    );
    await c.query(
      `insert into thread_revisions (thread_id, synthesis, trigger_note) values ($1, $2, $3)`,
      [threadId, synthesisHtml, triggerNote]
    );
  });
}

export async function createThread(slug: string, title: string, question: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into research_threads (slug, title, question) values ($1, $2, $3)
     on conflict (slug) do nothing
     returning id`,
    [slug, title, question]
  );
  if (!row) throw new Error('A thread with that slug already exists.');
  return row.id;
}

export async function setThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
  await exec(`update research_threads set status = $1, updated_at = now() where id = $2`, [status, threadId]);
}

// Persist (or clear) the latest thread scan — singleton row, mirrors concept_gap_scan.
export async function saveThreadScan(scan: ResearchThreadScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`delete from research_thread_scan where id = true`, []);
    return;
  }
  await exec(
    `insert into research_thread_scan (id, recommendation, generated_at)
     values (true, $1::jsonb, now())
     on conflict (id) do update set recommendation = excluded.recommendation, generated_at = now()`,
    [JSON.stringify(scan)]
  );
}

// ---- Research phase 4: citation self-correction -------------------------------

export async function bulkUpdatePedigree(
  pairs: { id: string; count: number | null; hindex: number | null }[]
): Promise<void> {
  if (!pairs.length) return;
  await exec(
    `update papers p set
        citation_count = coalesce(u.count, p.citation_count),
        author_hindex = coalesce(u.hindex, p.author_hindex),
        citations_checked_at = now(), updated_at = now()
       from unnest($1::uuid[], $2::int[], $3::int[]) as u(id, count, hindex)
      where p.id = u.id`,
    [pairs.map((p) => p.id), pairs.map((p) => p.count), pairs.map((p) => p.hindex)]
  );
}

// Put a paper the funnel passed on back into the review queue (the rising-rejects
// second chance): triage flips to kept, the review decision resets to pending.
export async function requeuePaper(paperId: string): Promise<void> {
  await exec(
    `update papers set triage_status = 'kept', review_status = 'pending',
            triage_reason = coalesce(triage_reason, '') || ' [requeued: rising citations]',
            updated_at = now()
      where id = $1`,
    [paperId]
  );
}

// ---- Theses + thesis reports (migration 0027) --------------------------------
// The thesis writers are the only path that persists a claim mapping, and they
// REFUSE a dangling code (edges-without-FK discipline, same as createClaimWithEdges):
// every code must name a live non-frame claim or a bridge-claim at write time.
// Frames are quarantined from evidence, so they are not valid thesis targets.

async function assertThesisCodesResolve(codes: string[]): Promise<void> {
  if (!codes.length) return;
  const rows = await q<{ code: string }>(
    `select code from claims where code = any($1::text[]) and is_frame = false
     union all
     select code from bridge_claims where code = any($1::text[])`,
    [codes]
  );
  const live = new Set(rows.map((r) => r.code));
  const dangling = codes.filter((c) => !live.has(c));
  if (dangling.length) throw new Error(`Unknown claim code${dangling.length > 1 ? 's' : ''}: ${dangling.join(', ')}`);
}

export async function createThesis(input: {
  statement: string;
  claim_codes: string[];
  mapping_note?: string | null;
}): Promise<string> {
  await assertThesisCodesResolve(input.claim_codes);
  const row = await one<{ id: string }>(
    `insert into theses (statement, claim_codes, mapping_note)
     values ($1, $2::text[], $3) returning id`,
    [input.statement, input.claim_codes, input.mapping_note || null]
  );
  return row!.id;
}

export async function updateThesis(
  id: string,
  input: { statement: string; claim_codes: string[]; mapping_note?: string | null }
): Promise<void> {
  await assertThesisCodesResolve(input.claim_codes);
  await exec(
    `update theses set statement = $2, claim_codes = $3::text[], mapping_note = $4 where id = $1`,
    [id, input.statement, input.claim_codes, input.mapping_note || null]
  );
}

// Persist (or clear) a thesis's gap scan (migration 0036; the per-thesis analogue
// of saveArgumentGapScan). An empty scan clears the column.
export async function saveThesisGapScan(id: string, scan: ArgumentGapScan | null): Promise<void> {
  if (!scan || !scan.recommendations.length) {
    await exec(`update theses set gap_scan = null where id = $1`, [id]);
    return;
  }
  await exec(`update theses set gap_scan = $2::jsonb where id = $1`, [id, JSON.stringify(scan)]);
}

// Append one code to a thesis's mapping (the create-from-thesis-gap loop closure:
// the human submitted the authoring form from THIS thesis's scan). Fill-only:
// no-op when the code is already mapped; refuses a dangling code like the other
// thesis writers.
export async function appendThesisCode(id: string, code: string): Promise<void> {
  await assertThesisCodesResolve([code]);
  await exec(
    `update theses set claim_codes = array_append(claim_codes, $2)
      where id = $1 and not (claim_codes @> array[$2]::text[])`,
    [id, code]
  );
}

export async function setThesisStatus(id: string, status: 'active' | 'archived'): Promise<void> {
  await exec(`update theses set status = $2::thesis_status_t where id = $1`, [id, status]);
}

export async function deleteThesis(id: string): Promise<void> {
  await exec(`delete from theses where id = $1`, [id]);   // reports cascade
}

// A thesis report is an immutable run: always an insert (a re-run is a NEW row so
// the delta chain stays honest). The caller (saveThesisReportAction) sanitizes and
// citation-gates the narrative and re-derives signal_ids from the pack.
export async function saveThesisReport(input: {
  thesis_id: string;
  title: string;
  statement: string;
  pack: unknown;
  narrative: unknown;
  signal_ids: string[];
  generated_at: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into thesis_reports (thesis_id, title, statement, pack, narrative, signal_ids, generated_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::uuid[], $7::timestamptz)
     returning id`,
    [
      input.thesis_id, input.title, input.statement,
      JSON.stringify(input.pack), JSON.stringify(input.narrative),
      input.signal_ids, input.generated_at,
    ]
  );
  return row!.id;
}

export async function deleteThesisReport(id: string): Promise<void> {
  await exec(`delete from thesis_reports where id = $1`, [id]);
}

// ---- Generated reports (the Report Portal's tear sheets, migration 0030) ----
// Insert-only like thesis reports: a re-run is a NEW row. The caller
// (saveSheetAction) re-gates the narrative against the pack at the save boundary.
export async function saveGeneratedReport(input: {
  kind: 'claim' | 'bridge' | 'lens' | 'atlas';
  subject: string | null;
  title: string;
  scope_from: string | null;
  scope_to: string | null;
  pack: unknown;
  narrative: unknown;
  generated_at: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into generated_reports (kind, subject, title, scope_from, scope_to, pack, narrative, generated_at)
     values ($1::report_kind_t, $2, $3, $4::date, $5::date, $6::jsonb, $7::jsonb, $8::timestamptz)
     returning id`,
    [
      input.kind, input.subject, input.title, input.scope_from, input.scope_to,
      JSON.stringify(input.pack), JSON.stringify(input.narrative), input.generated_at,
    ]
  );
  return row!.id;
}

// The one mutable field: publishing is the human gate that lists a generated
// report on the public portal and opens its PDF download.
export async function setGeneratedReportPublished(id: string, on: boolean): Promise<void> {
  await exec(`update generated_reports set is_published = $2 where id = $1`, [id, on]);
}

export async function deleteGeneratedReport(id: string): Promise<void> {
  await exec(`delete from generated_reports where id = $1`, [id]);
}

// Append claim touches to an EXISTING signal and re-materialize its evidence.
// Additive by design: codes the signal already touches keep their original
// direction/reason (human-reviewed at publish time; never clobbered). Used by the
// labor backfill (0028) and safe for any future retro-tagging: the evidence
// re-sync runs in the same transaction, so the Signal Board and the Argument Map
// can never disagree.
export async function addSignalTouches(
  signalId: string,
  touches: { code: string; direction: Direction; reason: string }[]
): Promise<{ added: string[] }> {
  return withTx(async (c) => {
    const sig = (
      await c.query(
        `select claim_touches, touch_details, is_published from signals where id = $1 for update`,
        [signalId]
      )
    ).rows[0] as
      | { claim_touches: string[]; touch_details: Record<string, unknown> | null; is_published: boolean }
      | undefined;
    if (!sig) throw new Error('Signal not found.');

    const codes = new Set(sig.claim_touches ?? []);
    const details: Record<string, unknown> = { ...(sig.touch_details ?? {}) };
    const added: string[] = [];
    for (const t of touches) {
      if (codes.has(t.code)) continue;   // existing touch: human-reviewed, keep as is
      codes.add(t.code);
      details[t.code] = { direction: t.direction, reason: t.reason };
      added.push(t.code);
    }
    if (added.length) {
      await c.query(
        `update signals set claim_touches = $2::text[], touch_details = $3::jsonb, updated_at = now()
          where id = $1`,
        [signalId, [...codes], JSON.stringify(details)]
      );
      await syncSignalEvidence(c, signalId, sig.is_published);
    }
    return { added };
  });
}

// ---- Tickets — the public feedback box (migration 0032) ---------------------
// createTicket is the ONE public write path in this module: it is called by the
// allow-listed POST /api/tickets route after validation (length caps, email
// shape, image count/size/magic bytes, honeypot). Everything else is admin.

export async function createTicket(input: {
  kind: 'bug' | 'feature';
  title: string;
  body: string;
  email: string;
  severity: string | null;
  page: string | null;
  userAgent: string | null;
  images: { contentType: string; bytes: Buffer }[];
}): Promise<string> {
  return withTx(async (c) => {
    const row = await c.query(
      `insert into tickets (kind, title, body, email, severity, page, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [input.kind, input.title, input.body, input.email, input.severity, input.page, input.userAgent]
    );
    const id = row.rows[0].id as string;
    for (const img of input.images) {
      await c.query(
        `insert into ticket_images (ticket_id, content_type, bytes) values ($1, $2, $3)`,
        [id, img.contentType, img.bytes]
      );
    }
    return id;
  });
}

export async function setTicketStatus(id: string, status: 'open' | 'in_progress' | 'resolved' | 'declined'): Promise<void> {
  await exec(
    `update tickets set status = $2::ticket_status_t,
            resolved_at = case when $2 in ('resolved', 'declined') then now() else null end
      where id = $1`,
    [id, status]
  );
}

export async function setTicketAdminNote(id: string, note: string | null): Promise<void> {
  await exec(`update tickets set admin_note = $2 where id = $1`, [id, note]);
}

export async function deleteTicket(id: string): Promise<void> {
  await exec(`delete from tickets where id = $1`, [id]);
}

// ---- Queue agent (migration 0033) -------------------------------------------
// Recommendations are advisory rows on papers; the review actions below remain
// the only path that changes review_status (human commits, per row or in bulk).

export async function setAgentRecommendations(rows: {
  id: string;
  recommendation: 'tracked' | 'noted' | 'dismissed';
  confidence: number;
  reason: string;
  cluster: string | null;
}[]): Promise<number> {
  return withTx(async (c) => {
    let n = 0;
    for (const r of rows) {
      const res = await c.query(
        `update papers
            set agent_recommendation = $2, agent_reason = $3, agent_confidence = $4,
                agent_cluster = $5, agent_at = now(), updated_at = now()
          where id = $1 and triage_status = 'kept' and review_status = 'pending'`,
        [r.id, r.recommendation, r.reason, Math.max(0, Math.min(100, Math.round(r.confidence))), r.cluster]
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

export async function saveSteeringNote(text: string | null): Promise<void> {
  await exec(
    `insert into research_agent_prefs (id, steering) values (true, $1)
     on conflict (id) do update set steering = excluded.steering, updated_at = now()`,
    [text]
  );
}

// Bulk accept of agent recommendations: applies the SAME review write as a
// manual decision to every pending paper whose recommendation matches. Track
// whys come from the agent reason (editable later on the paper page). Returns
// the affected ids so the console can chain finding extraction for tracks.
export async function acceptAgentRecommendations(
  decision: 'tracked' | 'noted' | 'dismissed'
): Promise<string[]> {
  return withTx(async (c) => {
    const res = await c.query(
      `update papers
          set review_status = $1,
              review_note = case when $1 = 'tracked'
                then coalesce(nullif(agent_reason, ''), 'Tracked on the queue agent''s recommendation.')
                else review_note end,
              reviewed_at = now(), updated_at = now()
        where triage_status = 'kept' and review_status = 'pending' and agent_recommendation = $1
        returning id`,
      [decision]
    );
    return res.rows.map((r) => r.id as string);
  });
}

// ---- Startup Scout (migration 0034) -----------------------------------------
// Companies follow the papers model: the row is both library and funnel state,
// deduped GLOBALLY by domain and normalized name. The review write below is the
// only path that changes status (the human gate on the acquisition funnel).

export async function createCompany(input: {
  name: string;
  url?: string | null;
  vertical: string;
  one_liner?: string | null;
  ai_tech?: string | null;
  founded_year?: number | null;
  stage?: CompanyStage;
  funding_note?: string | null;
  hq?: string | null;
  origin?: 'discovery' | 'manual';
  run_id?: string | null;
  found_url?: string | null;
}): Promise<{ id: string; existed: boolean }> {
  const domain = input.url ? domainOf(input.url) || null : null;
  const existing = await one<{ id: string }>(
    `select id from companies
      where (($1::text is not null and domain = $1) or name_key = $2) limit 1`,
    [domain, companyNameKey(input.name)]
  );
  if (existing) return { id: existing.id, existed: true };
  const row = await one<{ id: string }>(
    `insert into companies
       (name, domain, url, vertical, one_liner, ai_tech, founded_year, stage,
        funding_note, hq, origin, run_id, found_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      sanitizeText(input.name).slice(0, 200), domain, input.url ?? null, input.vertical,
      input.one_liner ? sanitizeText(input.one_liner) : null,
      input.ai_tech ? sanitizeText(input.ai_tech) : null,
      input.founded_year ?? null, input.stage ?? 'unknown',
      input.funding_note ? sanitizeText(input.funding_note) : null,
      input.hq ? sanitizeText(input.hq) : null,
      input.origin ?? 'manual', input.run_id ?? null, input.found_url ?? null,
    ]
  );
  return { id: row!.id, existed: false };
}

// The review decision + its why. Tracking requires a note — enforced in the
// action; this just writes. Reversible: any status can move to any other.
export async function reviewCompany(id: string, status: CompanyStatus, note: string | null): Promise<void> {
  await exec(
    `update companies set status = $1, review_note = coalesce($2, review_note),
            reviewed_at = now(), updated_at = now()
      where id = $3`,
    [status, note, id]
  );
}

// Admin fact edits from the profile page (the human's text always wins; the
// future enrichment leg fills only nulls and never touches an edited field).
export async function updateCompanyFacts(id: string, input: {
  one_liner?: string | null;
  ai_tech?: string | null;
  founded_year?: number | null;
  stage?: CompanyStage;
  funding_note?: string | null;
  hq?: string | null;
}): Promise<void> {
  await exec(
    `update companies
        set one_liner = $1, ai_tech = $2, founded_year = $3, stage = $4,
            funding_note = $5, hq = $6, updated_at = now()
      where id = $7`,
    [
      input.one_liner ? sanitizeText(input.one_liner) : null,
      input.ai_tech ? sanitizeText(input.ai_tech) : null,
      input.founded_year ?? null, input.stage ?? 'unknown',
      input.funding_note ? sanitizeText(input.funding_note) : null,
      input.hq ? sanitizeText(input.hq) : null,
      id,
    ]
  );
}

export async function createCompanyEvent(input: {
  company_id: string;
  event_date: string;   // 'YYYY-MM-DD'
  kind: CompanyEventKind;
  title: string;
  url?: string | null;
  note?: string | null;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into company_events (company_id, event_date, kind, title, url, note)
     values ($1, $2::date, $3, $4, $5, $6) returning id`,
    [
      input.company_id, input.event_date, input.kind,
      sanitizeText(input.title).slice(0, 300), input.url ?? null,
      input.note ? sanitizeText(input.note) : null,
    ]
  );
  return row!.id;
}

export async function deleteCompanyEvent(id: string): Promise<void> {
  await exec(`delete from company_events where id = $1`, [id]);
}

export async function upsertVertical(input: {
  slug: string;
  name: string;
  description?: string | null;
  search_queries?: string[];
}): Promise<void> {
  await exec(
    `insert into scout_verticals (slug, name, description, search_queries)
     values ($1, $2, $3, $4)
     on conflict (slug) do update
       set name = excluded.name, description = excluded.description,
           search_queries = case when array_length(excluded.search_queries, 1) is null
                            then scout_verticals.search_queries else excluded.search_queries end`,
    [input.slug, sanitizeText(input.name).slice(0, 80),
     input.description ? sanitizeText(input.description) : null,
     input.search_queries ?? []]
  );
}

export async function setVerticalActive(slug: string, active: boolean): Promise<void> {
  await exec(`update scout_verticals set active = $2 where slug = $1`, [slug, active]);
}

// ---- Scout enrichment (phase 4) ---------------------------------------------

export async function setCompanyRawContent(id: string, text: string, via: string): Promise<void> {
  await exec(
    `update companies set raw_content = $2, fetched_via = $3, updated_at = now() where id = $1`,
    [id, sanitizeText(text), via]
  );
}

export interface CompanyFactsFill {
  one_liner: string | null;
  ai_tech: string | null;
  founded_year: number | null;
  stage: CompanyStage;
  funding_note: string | null;
  hq: string | null;
}

// Fill-only-null on the fact columns (the human's edits always win; stage uses
// 'unknown' as its null sentinel). Returns which columns were actually filled,
// for the research panel's log line.
export async function fillCompanyFacts(id: string, input: CompanyFactsFill): Promise<string[]> {
  return withTx(async (c) => {
    const before = await c.query(
      `select one_liner, ai_tech, founded_year, stage, funding_note, hq from companies where id = $1`,
      [id]
    );
    if (!before.rowCount) return [];
    const b = before.rows[0];
    await c.query(
      `update companies
          set one_liner = coalesce(one_liner, $2),
              ai_tech = coalesce(ai_tech, $3),
              founded_year = coalesce(founded_year, $4),
              stage = case when stage = 'unknown' then $5::company_stage_t else stage end,
              funding_note = coalesce(funding_note, $6),
              hq = coalesce(hq, $7),
              updated_at = now()
        where id = $1`,
      [
        id,
        input.one_liner ? sanitizeText(input.one_liner) : null,
        input.ai_tech ? sanitizeText(input.ai_tech) : null,
        input.founded_year,
        input.stage,
        input.funding_note ? sanitizeText(input.funding_note) : null,
        input.hq ? sanitizeText(input.hq) : null,
      ]
    );
    const filled: string[] = [];
    if (!b.one_liner && input.one_liner) filled.push('one-liner');
    if (!b.ai_tech && input.ai_tech) filled.push('AI tech');
    if (!b.founded_year && input.founded_year) filled.push('founded');
    if (b.stage === 'unknown' && input.stage !== 'unknown') filled.push('stage');
    if (!b.funding_note && input.funding_note) filled.push('funding');
    if (!b.hq && input.hq) filled.push('hq');
    return filled;
  });
}

// The dossier has THREE writers (homepage enrich, the intel sweep, document
// extraction), so it merges monotonically (lib/scout/core.ts mergeDossier)
// instead of being replaced wholesale: no tool can erase another's finds.
export async function mergeCompanyDossier(
  id: string,
  patch: { summary: string | null; products: string[]; customers: string[]; sources: string[]; updated_by: ScoutDossier['updated_by'] }
): Promise<void> {
  await withTx(async (c) => {
    const res = await c.query(`select dossier from companies where id = $1 for update`, [id]);
    if (!res.rowCount) return;
    const merged = mergeDossier(res.rows[0].dossier ?? null, patch, new Date().toISOString());
    await c.query(
      `update companies set dossier = $2::jsonb, updated_at = now() where id = $1`,
      [id, JSON.stringify(merged)]
    );
  });
}

// The homepage-enrichment writer, composed of the two halves above.
export async function updateCompanyEnrichment(id: string, input: CompanyFactsFill & {
  dossier: { summary: string | null; products: string[]; customers: string[]; sources: string[]; updated_by: ScoutDossier['updated_by'] };
}): Promise<string[]> {
  const filled = await fillCompanyFacts(id, input);
  await mergeCompanyDossier(id, input.dossier);
  return filled;
}

// ---- Scout documents (migration 0035) ---------------------------------------

export async function createCompanyDocument(input: {
  company_id: string;
  filename: string;
  origin: 'admin' | 'portal';
  text: string;
}): Promise<string> {
  const text = sanitizeText(input.text).slice(0, 200_000);
  const row = await one<{ id: string }>(
    `insert into company_documents (company_id, filename, origin, char_count, text)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.company_id, sanitizeText(input.filename).slice(0, 200), input.origin, [...text].length, text]
  );
  return row!.id;
}

export async function setDocumentSummary(id: string, summary: string | null): Promise<void> {
  await exec(`update company_documents set doc_summary = $2 where id = $1`, [id, summary]);
}

export async function deleteCompanyDocument(id: string): Promise<void> {
  await exec(`delete from company_documents where id = $1`, [id]);
}

// ---- Scout scoring agent (phase 3) ------------------------------------------
// Recommendations are advisory columns on companies; reviewCompany above stays
// the only path that changes status (human commits, per row or in bulk).

export async function setScoutRecommendations(rows: {
  id: string;
  verdict: ScoutVerdict;
  confidence: number;
  reason: string;
  scores: ScoutScores;
}[]): Promise<number> {
  const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
  return withTx(async (c) => {
    let n = 0;
    for (const r of rows) {
      const scores: ScoutScores = {
        ai_depth: clamp5(r.scores?.ai_depth),
        acquisition_fit: clamp5(r.scores?.acquisition_fit),
        traction: clamp5(r.scores?.traction),
        team: clamp5(r.scores?.team),
        integration_cost: clamp5(r.scores?.integration_cost),
      };
      const res = await c.query(
        `update companies
            set agent_verdict = $2, agent_reason = $3, agent_confidence = $4,
                agent_scores = $5::jsonb, agent_at = now(), updated_at = now()
          where id = $1 and status = 'queued'`,
        [
          r.id, r.verdict, r.reason,
          Math.max(0, Math.min(100, Math.round(r.confidence))),
          JSON.stringify(scores),
        ]
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

export async function saveScoutPrefs(steering: string | null, rubric: string | null): Promise<void> {
  await exec(
    `insert into scout_prefs (id, steering, rubric) values (true, $1, $2)
     on conflict (id) do update
       set steering = excluded.steering, rubric = excluded.rubric, updated_at = now()`,
    [steering, rubric]
  );
}

// Bulk accept of agent verdicts: pursue tracks (the agent's reason becomes the
// review note, editable later), pass dismisses. Watch stays queued for per-row
// judgment. The SAME review write as a manual decision.
export async function acceptScoutRecommendations(verdict: 'pursue' | 'pass'): Promise<string[]> {
  const status = verdict === 'pursue' ? 'tracked' : 'dismissed';
  return withTx(async (c) => {
    const res = await c.query(
      `update companies
          set status = $1,
              review_note = case when $1 = 'tracked'
                then coalesce(nullif(agent_reason, ''), 'Tracked on the scout agent''s recommendation.')
                else review_note end,
              reviewed_at = now(), updated_at = now()
        where status = 'queued' and agent_verdict = $2
        returning id`,
      [status, verdict]
    );
    return res.rows.map((r) => r.id as string);
  });
}

// ---- Scout discovery (phase 2) ----------------------------------------------

export async function createScoutRun(): Promise<string> {
  const row = await one<{ id: string }>(`insert into scout_runs default values returning id`);
  return row!.id;
}

export async function completeScoutRun(id: string): Promise<void> {
  await exec(
    `update scout_runs set status = 'completed', step = 'complete', updated_at = now() where id = $1`,
    [id]
  );
}

export async function failScoutRun(id: string, error: string): Promise<void> {
  await exec(
    `update scout_runs set status = 'failed', error = $2, updated_at = now() where id = $1`,
    [id, error.slice(0, 500)]
  );
}

export async function bumpScoutRunCounts(id: string, found: number, inserted: number): Promise<void> {
  await exec(
    `update scout_runs set found_count = found_count + $2, new_count = new_count + $3, updated_at = now()
      where id = $1`,
    [id, found, inserted]
  );
}

// Discovery inserts: dedupe GLOBALLY (any status — a dismissed company is never
// re-queued) by domain and normalized name, and within the batch itself, since
// one run can surface the same company under two verticals. All-or-nothing per
// batch via withTx so a retried batch never half-inserts.
export async function insertCompanies(
  runId: string | null,   // null for run-less inserts (the competitor scan)
  vertical: string,
  companies: {
    name: string; url: string; one_liner: string; stage_hint: string;
    founded_hint: string; funding_note: string; found_url: string;
  }[]
): Promise<{ found: number; inserted: number }> {
  if (!companies.length) return { found: 0, inserted: 0 };
  return withTx(async (c) => {
    let inserted = 0;
    const seenInBatch = new Set<string>();
    for (const raw of companies) {
      const domain = raw.url ? domainOf(raw.url) || null : null;
      const nameKey = companyNameKey(raw.name);
      if (!nameKey) continue;
      const batchKey = domain ?? nameKey;
      if (seenInBatch.has(batchKey) || seenInBatch.has(nameKey)) continue;
      seenInBatch.add(batchKey);
      seenInBatch.add(nameKey);
      const existing = await c.query(
        `select id from companies
          where (($1::text is not null and domain = $1) or name_key = $2) limit 1`,
        [domain, nameKey]
      );
      if (existing.rowCount) continue;
      await c.query(
        `insert into companies
           (name, domain, url, vertical, one_liner, founded_year, stage, funding_note,
            origin, run_id, found_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'discovery', $9, $10)`,
        [
          sanitizeText(raw.name).slice(0, 200), domain, raw.url || null, vertical,
          raw.one_liner ? sanitizeText(raw.one_liner) : null,
          parseFoundedHint(raw.founded_hint), parseStageHint(raw.stage_hint),
          raw.funding_note ? sanitizeText(raw.funding_note) : null,
          runId, raw.found_url || null,
        ]
      );
      inserted += 1;
    }
    return { found: companies.length, inserted };
  });
}

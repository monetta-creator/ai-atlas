import { one, exec, withTx } from '../db';
import type { PoolClient } from 'pg';
import type {
  Direction, Weight, Dossier, QuestionSummary, SummaryMetrics, SignalBrief, SignalCounterpoint,
  } from '../types';

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

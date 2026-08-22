import { one, exec, withTx } from '../db';
import type { PoolClient } from 'pg';
import type {
  Direction, Weight, Dossier, HypothesisStatus, Resolvability, SignalBrief, SignalCounterpoint,
  } from '../types';

// All writes go through here (server-only). The guarded server actions in
// lib/actions/* are the only callers, and every one re-checks isAdmin first.

// ---- hypotheses --------------------------------------------------------------

// Auto-assign the next H<n> code atomically with the insert. New hypotheses
// start at NEUTRAL 0.50 (the schema default); the first conviction move through
// the gate records the why.
export async function createHypothesis(input: {
  statement: string;
  test: string;
  note?: string | null;
  resolvability?: Resolvability | null;
}): Promise<{ id: string; code: string }> {
  return withTx(async (c) => {
    const next = (await c.query(
      `select coalesce(max(substring(code from 2)::int), 0) + 1 as n
         from hypotheses where code ~ '^H[0-9]+$'`
    )).rows[0] as { n: number };
    const code = `H${next.n}`;
    const row = (await c.query(
      `insert into hypotheses (code, statement, test, note, resolvability)
       values ($1, $2, $3, $4, $5) returning id`,
      [code, input.statement, input.test, input.note ?? null, input.resolvability ?? null]
    )).rows[0] as { id: string };
    return { id: row.id, code };
  });
}

export async function updateHypothesis(id: string, input: {
  statement?: string;
  test?: string;
  note?: string | null;
  resolvability?: Resolvability | null;
  status?: HypothesisStatus;
}): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (input.statement !== undefined) set('statement', input.statement);
  if (input.test !== undefined) set('test', input.test);
  if (input.note !== undefined) set('note', input.note);
  if (input.resolvability !== undefined) set('resolvability', input.resolvability);
  if (input.status !== undefined) set('status', input.status);
  if (!sets.length) return;
  params.push(id);
  await exec(`update hypotheses set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

// Deleting a hypothesis cascades its evidence, rationales, links, and reports.
export async function deleteHypothesis(id: string): Promise<void> {
  await exec(`delete from hypotheses where id = $1`, [id]);
}

// Promote-and-link (D-016): relate two hypotheses. Symmetric enough for v0 —
// the reader sees links from either end.
export async function linkHypotheses(fromId: string, toId: string, note?: string | null): Promise<void> {
  await exec(
    `insert into hypothesis_links (from_id, to_id, note) values ($1, $2, $3)
     on conflict (from_id, to_id) do update set note = excluded.note`,
    [fromId, toId, note ?? null]
  );
}

export async function unlinkHypotheses(fromId: string, toId: string): Promise<void> {
  await exec(
    `delete from hypothesis_links
      where (from_id = $1 and to_id = $2) or (from_id = $2 and to_id = $1)`,
    [fromId, toId]
  );
}

// ---- sources -----------------------------------------------------------------

export async function createSource(input: {
  title?: string;
  author?: string;
  outlet?: string;
  url?: string;
  published_at?: string;
  raw_text?: string;
  reliability_prior?: number | null;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into sources (title, author, outlet, url, published_at, raw_text, reliability_prior)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      input.title || null,
      input.author || null,
      input.outlet || null,
      input.url || null,
      input.published_at || null,
      input.raw_text || null,
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

// Cache the AI briefing + counterpoint onto a signal. Written in one shot from a
// single generation; updateSignal never touches these columns, so editing a
// signal preserves a cached analysis (the admin regenerates if it drifts).
export async function setSignalAnalysis(
  signalId: string, brief: SignalBrief, counterpoint: SignalCounterpoint
): Promise<void> {
  await exec(
    `update signals set brief = $1::jsonb, counterpoint = $2::jsonb, updated_at = now() where id = $3`,
    [JSON.stringify(brief), JSON.stringify(counterpoint), signalId]
  );
}

// ---- evidence ----------------------------------------------------------------

// Attach one source as evidence to many hypotheses at once, atomic.
export async function addEvidenceMany(
  items: {
    source_id: string;
    hypothesis_id: string;
    direction: Direction;
    confidence: Weight;
    excerpt?: string;
    note?: string;
  }[]
): Promise<void> {
  if (!items.length) return;
  await withTx(async (c) => {
    for (const it of items) {
      await c.query(
        `insert into evidence (source_id, hypothesis_id, direction, confidence, excerpt, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [it.source_id, it.hypothesis_id, it.direction, it.confidence, it.excerpt || null, it.note || null]
      );
    }
  });
}

// Delete a source entirely. Its evidence rows cascade, and
// rationales.evidence_id is set null.
export async function deleteSource(sourceId: string): Promise<void> {
  await exec(`delete from sources where id = $1`, [sourceId]);
}

// Repoint one evidence link to a different hypothesis.
export async function reassignEvidence(evidenceId: string, hypothesisId: string): Promise<void> {
  await exec(`update evidence set hypothesis_id = $1, updated_at = now() where id = $2`, [
    hypothesisId,
    evidenceId,
  ]);
}

// Edit an evidence link's judgment (confidence word / direction / note).
export async function updateEvidenceLink(evidenceId: string, input: {
  direction?: Direction;
  confidence?: Weight;
  note?: string | null;
}): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (input.direction !== undefined) set('direction', input.direction);
  if (input.confidence !== undefined) set('confidence', input.confidence);
  if (input.note !== undefined) set('note', input.note);
  if (!sets.length) return;
  params.push(evidenceId);
  await exec(`update evidence set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
}

export async function deleteEvidence(evidenceId: string): Promise<void> {
  await exec(`delete from evidence where id = $1`, [evidenceId]);
}

// ---- the human gate ----------------------------------------------------------

// Move a conviction AND record why AND snapshot — all atomic. If any step
// fails, the whole thing rolls back, so a conviction can never move without
// its rationale. (D-017: the hypothesis-level judgment is conviction.)
export async function moveConviction(input: {
  hypothesis_id: string;
  new_conviction: number;
  reason: string;
  evidence_id?: string | null;
}): Promise<void> {
  await withTx(async (c) => {
    const cur = (await c.query(`select conviction from hypotheses where id = $1`, [input.hypothesis_id]))
      .rows[0] as { conviction: number | null } | undefined;
    if (!cur) throw new Error('hypothesis not found');

    await c.query(`update hypotheses set conviction = $1, updated_at = now() where id = $2`, [
      input.new_conviction,
      input.hypothesis_id,
    ]);
    await c.query(
      `insert into rationales (hypothesis_id, old_conviction, new_conviction, reason, evidence_id)
       values ($1,$2,$3,$4,$5)`,
      [input.hypothesis_id, cur.conviction, input.new_conviction, input.reason, input.evidence_id || null]
    );
    await snapshotOnClient(c, 'post_commit');
  });
}

async function snapshotOnClient(
  c: PoolClient,
  trigger: 'manual' | 'post_commit' | 'scheduled'
): Promise<void> {
  const hyps = await c.query(`select id, conviction from hypotheses`);
  const state = {
    hypotheses: Object.fromEntries(hyps.rows.map((r) => [r.id, r.conviction])),
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

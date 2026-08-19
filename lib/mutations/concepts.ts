import { exec, withTx } from '../db';
import type { PoolClient } from 'pg';
import type {
  ConceptGapScan, Domain, Resolvability, Relation, ArgumentGapScan,
  } from '../types';

// ---- Concepts (the semantic scaffold; migration 0017) -----------------------
// The AI only ever recommends prerequisite edges and claim links back to the
// client; these writers receive what the admin confirmed and write it as
// status='confirmed'. Links are replaced wholesale inside the transaction so the
// form's state is the single source of truth for a concept's wiring.

interface ConceptWrite {
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

interface ClaimEdgeInput {
  target_type: 'stance' | 'bridge_claim';
  target_code: string;
  relation: Relation;          // supports | contradicts | depends_on (organizes is frame-only)
}

interface CreateClaimInput {
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

interface BridgeFeedInput { claim_code: string; relation: Relation; }  // claim -> bridge

interface CreateBridgeInput {
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

import { exec, withTx } from '../db';
import type { PoolClient } from 'pg';
import type {
  ConceptGapScan, ArgumentGapScan,
  } from '../types';

// ---- Concepts (the semantic scaffold) ----------------------------------------
// The AI only ever recommends prerequisite edges and hypothesis links back to
// the client; these writers receive what the admin confirmed and write it as
// status='confirmed'. Links are replaced wholesale inside the transaction so the
// form's state is the single source of truth for a concept's wiring.

interface ConceptWrite {
  slug: string;
  name: string;
  short_definition: string;
  explanation: string | null;
  status: 'settled' | 'contested';
  prerequisite_ids: string[];
  codes: string[];               // hypothesis codes the concept is wired to
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
  await c.query(`delete from concept_links where concept_id = $1`, [conceptId]);
  for (const code of input.codes) {
    await c.query(
      `insert into concept_links (concept_id, code, status)
       values ($1, $2, 'confirmed') on conflict do nothing`,
      [conceptId, code]
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

// Edges and hypothesis links cascade with the row.
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

// Persist (or clear) the latest atlas-wide hypothesis gap scan (singleton, mirrors saveConceptGapScan).
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

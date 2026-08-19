import { one, exec, withTx } from '../db';

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
const DOMAIN_FIELDS: Record<string, Record<string, FieldSpec>> = {
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

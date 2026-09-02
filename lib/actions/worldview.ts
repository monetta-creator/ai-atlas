'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as m from '../mutations';
import { UUID_RE, parseTarget, requireAdmin, requireUuid, str } from './shared';

// ---- Cross-cutting positions (the worldview layer) ----
const NODE_TYPES = ['stance', 'claim', 'bridge_claim'] as const;

export async function createPositionAction(formData: FormData) {
  await requireAdmin();
  const statement = str(formData, 'statement');
  if (!statement) throw new Error('A position needs a statement.');
  await m.createPosition(statement);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function updatePositionStatementAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  const statement = str(formData, 'statement');
  if (!UUID_RE.test(id)) throw new Error('Bad position id.');
  if (!statement) throw new Error('A position needs a statement.');
  await m.updatePositionStatement(id, statement);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function deletePositionAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'id');
  if (!UUID_RE.test(id)) throw new Error('Bad position id.');
  await m.deletePosition(id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function addPositionComponentAction(formData: FormData) {
  await requireAdmin();
  const positionId = requireUuid(formData, 'position_id', 'Position');
  // target is "claim:<id>" | "bridge_claim:<id>" | "stance:<id>"
  const { target_type, target_id } = parseTarget(str(formData, 'target'), NODE_TYPES);
  await m.addPositionComponent(positionId, target_type as 'stance' | 'claim' | 'bridge_claim', target_id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

export async function removePositionComponentAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, 'component_id');
  if (!UUID_RE.test(id)) throw new Error('Bad component id.');
  await m.removePositionComponent(id);
  revalidatePath('/', 'layout');
  redirect('/worldview');
}

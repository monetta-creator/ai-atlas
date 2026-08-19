'use server';

import { revalidatePath } from 'next/cache';
import * as m from '../mutations';
import { UUID_RE, requireAdmin } from './shared';

// ---- Tickets (the feedback box's admin console) ------------------------------
const TICKET_STATUSES = new Set(['open', 'in_progress', 'resolved', 'declined']);

export async function setTicketStatusAction(id: string, status: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  if (!TICKET_STATUSES.has(status)) throw new Error('Bad status.');
  await m.setTicketStatus(id, status as 'open' | 'in_progress' | 'resolved' | 'declined');
  revalidatePath('/tickets');
}

export async function setTicketNoteAction(id: string, note: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  const trimmed = note.trim().slice(0, 2000);
  await m.setTicketAdminNote(id, trimmed || null);
  revalidatePath('/tickets');
}

export async function deleteTicketAction(id: string): Promise<void> {
  await requireAdmin();
  if (!UUID_RE.test(id)) throw new Error('Bad ticket id.');
  await m.deleteTicket(id);
  revalidatePath('/tickets');
}

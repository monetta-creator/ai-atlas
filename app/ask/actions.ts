'use server';

import { redirect } from 'next/navigation';
import { checkPortalKey, setPortalSession } from '@/lib/auth';

// The one server action that deliberately does NOT call requireAdmin(): it IS
// the portal gate. checkPortalKey fails closed (no PORTAL_KEY set means the
// portal is off), and success grants only the signed portal cookie, which
// carries no write authority and no personal-layer access.

export interface UnlockState {
  error: string | null;
}

export async function unlockPortalAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const key = String(formData.get('key') ?? '').trim();
  if (!key || !checkPortalKey(key)) {
    return { error: 'That key did not match. Check with the Atlas owner and try again.' };
  }
  await setPortalSession();
  redirect('/ask');
}

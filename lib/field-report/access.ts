import type { PortalIdentity } from '../portal/keys';

// Who may run and read Field Reports: the admin, and a keyholder with an
// active PER-PERSON key (the legacy shared key cannot: the caps and a
// report's ownership both hang off the key id).
export interface FieldReportActor { actor: string; keyId: string | null; mode: 'admin' | 'portal' }

export function fieldReportActor(identity: PortalIdentity): FieldReportActor | null {
  if (identity.tier === 'admin') return { actor: 'admin', keyId: null, mode: 'admin' };
  if (identity.tier === 'key' && identity.active && identity.keyId) return { actor: `key:${identity.keyId}`, keyId: identity.keyId, mode: 'portal' };
  return null;
}

export function ownsRun(run: { created_by: string }, who: FieldReportActor): boolean {
  return who.actor === 'admin' || run.created_by === who.actor;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_STORE = { 'Cache-Control': 'no-store' };

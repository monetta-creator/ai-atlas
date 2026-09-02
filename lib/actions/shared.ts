// Shared guards + parsers for the server-action modules in this directory.
// NO 'use server' directive here: these are not actions, and a directive file
// may only export async functions. Never re-export this module from index.ts,
// and never import it into client code (it drags in server-only deps).
//
// requireUuid/parseTarget/isUniqueViolation (R8, 2026-09-01 audit) collect three
// idioms that used to be copy-pasted per action: a form id read straight into SQL
// with no UUID_RE check, a "type:id" target string split by hand, and the
// duplicate-key error message. Use them instead of re-inlining any of the three.

import { isAdmin, isPortal } from '../auth';
import type {
  Direction, Weight, } from '../types';

export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error('Unauthorized');
}

// Admin-or-portal gate for the scout research surface: isPortal() admits
// admins implicitly (lib/auth.ts). Portal-permitted actions ALSO re-check the
// target company's visibility and the daily budget; see the gate template on
// intelSweepAction.
export async function requirePortal() {
  if (!(await isPortal())) throw new Error('Unauthorized');
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export function parsePrior(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0 || n > 100) throw new Error('Reliability prior must be between 0 and 100.');
  return n;
}

// Only allow same-origin path redirects (no open redirect via a crafted form).
export function safePath(p: string): string {
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

export const UUID_RE = /^[0-9a-f-]{36}$/i;

// Read a form field and require it to be a UUID, or throw a friendly error naming
// the field (instead of the id reaching SQL unchecked and surfacing as a raw
// Postgres "invalid input syntax for type uuid" error).
export function requireUuid(fd: FormData, key: string, label?: string): string {
  const v = str(fd, key);
  if (!UUID_RE.test(v)) throw new Error(`${label || key} id is missing or invalid.`);
  return v;
}

// Split a "type:id" target string (the polymorphic evidence/edge/position-component
// picker convention), allow-list the type, and UUID-validate the id. Throws a
// friendly error on any of the three failures instead of letting a malformed
// target reach a mutation.
export function parseTarget(
  raw: unknown, allowed: readonly string[]
): { target_type: string; target_id: string } {
  const s = typeof raw === 'string' ? raw : '';
  const sep = s.indexOf(':');
  const target_type = sep < 0 ? s : s.slice(0, sep);
  const target_id = sep < 0 ? '' : s.slice(sep + 1);
  if (!allowed.includes(target_type)) throw new Error('Invalid target.');
  if (!UUID_RE.test(target_id)) throw new Error('Invalid target id.');
  return { target_type, target_id };
}

// The duplicate-key friendly-error idiom, copy-pasted per action until now.
export function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique/i.test(msg);
}

export const DIRECTIONS: Direction[] = ['supports', 'contradicts', 'neutral'];
export const WEIGHTS: Weight[] = ['high', 'medium', 'low'];

export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// FormData fields that carry a JSON string[] (lens picks, claim codes).
export function parseStringArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}


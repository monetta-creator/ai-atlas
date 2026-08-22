// Shared guards + parsers for the server-action modules in this directory.
// NO 'use server' directive here: these are not actions, and a directive file
// may only export async functions. Never re-export this module from index.ts,
// and never import it into client code (it drags in server-only deps).

import { isAdmin } from '../auth';
import type {
  Direction, Weight, } from '../types';

export async function requireAdmin() {
  if (!(await isAdmin())) throw new Error('Unauthorized');
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


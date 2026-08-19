import type { NextRequest } from 'next/server';
import { q } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { fetchRecord, type PeekKind } from '@/lib/ask/search';

// The Ask workspace's citation peek: GET /api/ask/peek?kind=<...>&id=<...>.
// Public (allow-listed in proxy.ts) and guest-safe by construction: payload
// columns are always public-shaped (lib/ask/search.ts); the one admin widening
// is signal ROW visibility so a draft-signal chip in an admin answer resolves
// instead of dead-ending. Nothing here shows what the record's own public page
// would not.
export const dynamic = 'force-dynamic';

const KINDS = new Set<string>(['claim', 'bridge', 'stance', 'question', 'concept', 'signal', 'paper', 'thread']);
const CODE_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function validId(kind: PeekKind, id: string): boolean {
  if (kind === 'signal' || kind === 'paper') return UUID_RE.test(id);
  if (kind === 'question' || kind === 'concept' || kind === 'thread') return SLUG_RE.test(id);
  return CODE_RE.test(id);
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') ?? '';
  const id = sp.get('id') ?? '';
  if (!KINDS.has(kind) || !validId(kind as PeekKind, id)) {
    return Response.json({ error: 'Unknown record.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const admin = await isAdmin();
  const payload = await fetchRecord(q, kind as PeekKind, id, { admin });
  if (!payload) {
    return Response.json({ error: 'Unknown record.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

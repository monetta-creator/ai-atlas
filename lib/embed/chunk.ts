// Pure chunking for the embedding pipeline: no imports besides node:crypto,
// so scripts/test-embed.mjs and scripts/backfill-embeddings.mjs (which cannot
// pull the app's extensionless lib/db chain, see that script's header note)
// can both load this module directly under plain Node type stripping.
//
// A record's text splits into ~800-token windows (approximated at 4
// chars/token, the standard rule of thumb for English prose) with a 100-token
// overlap so a fact split across a chunk boundary still appears whole in one
// of the two neighbouring chunks. Capped at 12 chunks per record: a signal or
// scan item over that length is reachable through FTS instead. Every chunk is
// prefixed with the record's title line so a mid-article chunk still carries
// its own context when retrieved alone.

import { createHash } from 'node:crypto';

export interface ChunkInput {
  title: string;
  text: string;
}

export interface Chunk {
  chunk_no: number;
  text: string;
  text_hash: string;
}

const CHARS_PER_TOKEN = 4;
export const CHUNK_TOKENS = 800;
export const OVERLAP_TOKENS = 100;
export const MAX_CHUNKS = 12;

const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export function hashText(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function chunkRecord(input: ChunkInput): Chunk[] {
  const title = (input.title ?? '').trim();
  const body = (input.text ?? '').trim();
  if (!body) return [];

  const prefix = title ? `${title}\n` : '';
  const stride = Math.max(1, CHUNK_CHARS - OVERLAP_CHARS);
  const chunks: Chunk[] = [];
  let start = 0;
  let chunkNo = 0;

  while (start < body.length && chunkNo < MAX_CHUNKS) {
    const slice = body.slice(start, start + CHUNK_CHARS).trim();
    if (slice) {
      const text = `${prefix}${slice}`;
      chunks.push({ chunk_no: chunkNo, text, text_hash: hashText(text) });
      chunkNo += 1;
    }
    if (start + CHUNK_CHARS >= body.length) break;
    start += stride;
  }

  return chunks;
}

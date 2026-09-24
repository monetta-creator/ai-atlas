import { q, exec } from '../db';
import { chunkRecord } from './chunk';
import { embedTexts, embedModel, toVectorLiteral } from './client';
import { getEmbeddable, type EmbedKind, type EmbeddableRecord } from './sources';

export type { EmbedKind, EmbeddableRecord } from './sources';
export { EMBED_KINDS } from './sources';

export interface UpsertResult {
  chunks: number;   // chunks embedded (new or changed text_hash)
  skipped: number;  // chunks whose text_hash was unchanged, not re-embedded
  removed: number;  // stale chunks deleted (a record's text shrank)
}

// Skips re-embedding a chunk whose text_hash is unchanged since the last run
// (the whole point of the hash: a nightly re-run over unchanged records costs
// nothing). Deletes any chunk_no beyond the record's current chunk count (the
// record's text shrank, or a re-chunk produced fewer windows).
export async function upsertEmbeddings(
  kind: EmbedKind,
  records: EmbeddableRecord[],
  opts: { model?: string } = {}
): Promise<UpsertResult> {
  const model = opts.model ?? embedModel();
  let chunks = 0;
  let skipped = 0;
  let removed = 0;

  for (const rec of records) {
    const built = chunkRecord({ title: rec.title, text: rec.text });

    const existing = await q<{ chunk_no: number; text_hash: string }>(
      `select chunk_no, text_hash from embeddings where kind = $1 and record_id = $2 and model = $3`,
      [kind, rec.record_id, model]
    );
    const existingByChunk = new Map(existing.map((e) => [e.chunk_no, e.text_hash]));

    if (!built.length) {
      if (existing.length) {
        removed += await exec(`delete from embeddings where kind = $1 and record_id = $2 and model = $3`, [kind, rec.record_id, model]);
      }
      continue;
    }

    const toEmbed = built.filter((c) => existingByChunk.get(c.chunk_no) !== c.text_hash);
    skipped += built.length - toEmbed.length;

    if (toEmbed.length) {
      const vectors = await embedTexts(toEmbed.map((c) => c.text), { feature: 'embed_index', model });
      for (let i = 0; i < toEmbed.length; i++) {
        const c = toEmbed[i];
        const vec = vectors[i];
        if (!vec) continue;
        await exec(
          `insert into embeddings (kind, record_id, chunk_no, model, text_hash, vec)
           values ($1, $2, $3, $4, $5, $6::vector)
           on conflict (kind, record_id, chunk_no, model)
           do update set text_hash = excluded.text_hash, vec = excluded.vec, created_at = now()`,
          [kind, rec.record_id, c.chunk_no, model, c.text_hash, toVectorLiteral(vec)]
        );
        chunks += 1;
      }
    }

    const maxChunkNo = built.length - 1;
    if (existing.some((e) => e.chunk_no > maxChunkNo)) {
      removed += await exec(
        `delete from embeddings where kind = $1 and record_id = $2 and model = $3 and chunk_no > $4`,
        [kind, rec.record_id, model, maxChunkNo]
      );
    }
  }

  return { chunks, skipped, removed };
}

export async function deleteEmbeddings(kind: EmbedKind, recordId: string): Promise<void> {
  await exec(`delete from embeddings where kind = $1 and record_id = $2`, [kind, recordId]);
}

// Convenience for a full or per-kind re-index: reads the current embeddable
// rows for `kind` straight from the DB and upserts them. Used by future
// incremental hooks and ad hoc re-indexing; scripts/backfill-embeddings.mjs
// does NOT use this (it cannot import lib/db's extensionless chain — see its
// header note) and instead runs the same sources.ts assemblers over a raw pg
// client.
export async function indexKind(kind: EmbedKind, opts: { model?: string } = {}): Promise<UpsertResult> {
  const records = await getEmbeddable(kind, q);
  return upsertEmbeddings(kind, records, opts);
}

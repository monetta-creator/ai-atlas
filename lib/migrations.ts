import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { q, withTx } from './db';

// Applying migrations from the deployed app (admin only): the same rules as
// scripts/migrate.mjs, run where the production connection already lives, so
// a migration that shipped with a deploy can be applied from a phone. Each
// pending file runs in its own transaction with its _migrations row; the run
// stops at the first failure and reports it. The files ship with the route
// through next.config.ts outputFileTracingIncludes ('/research/queue').
// DDL in one BEGIN..COMMIT on one client works through Supabase's
// transaction pooler, which is what DATABASE_URL points at on Vercel.

const DIR = path.join(process.cwd(), 'supabase', 'migrations');

async function migrationFiles(): Promise<string[]> {
  return (await readdir(DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
}

export async function getPendingMigrations(): Promise<string[]> {
  const [files, rows] = await Promise.all([
    migrationFiles(),
    q<{ filename: string }>(`select filename from _migrations`),
  ]);
  const applied = new Set(rows.map((r) => r.filename));
  return files.filter((f) => !applied.has(f));
}

export interface MigrationRun {
  applied: string[];
  failed: { file: string; error: string } | null;
  pending: string[];
}

export async function applyPendingMigrations(): Promise<MigrationRun> {
  const pending = await getPendingMigrations();
  const applied: string[] = [];
  for (const file of pending) {
    const sql = await readFile(path.join(DIR, file), 'utf8');
    try {
      await withTx(async (c) => {
        await c.query(sql);
        await c.query(`insert into _migrations (filename) values ($1)`, [file]);
      });
      applied.push(file);
    } catch (e) {
      return {
        applied,
        failed: { file, error: e instanceof Error ? e.message : String(e) },
        pending: pending.filter((f) => !applied.includes(f)),
      };
    }
  }
  return { applied, failed: null, pending: [] };
}

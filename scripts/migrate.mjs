import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClient } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '..', 'db', 'migrations');

const client = makeClient();

async function main() {
  await client.connect();
  await client.query(
    `create table if not exists _migrations (filename text primary key, applied_at timestamptz not null default now());`
  );
  // Deny-by-default like every other table; the migrate role owns this table
  // (owners bypass RLS), so migrations keep working.
  await client.query(`alter table _migrations enable row level security;`);
  const applied = new Set(
    (await client.query('select filename from _migrations')).rows.map((r) => r.filename)
  );
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`skip  ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, f), 'utf8');
    process.stdout.write(`apply ${f} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations(filename) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback');
      console.error(`\nFAILED ${f}:\n`, e.message);
      process.exitCode = 1;
      break;
    }
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Triage the research review queue down to N papers from the command line:
// the same pass as the review desk's "Triage down to" button
// (lib/research/queue-cap.ts), without the browser. Reads .env.local.
//
//   npx -y tsx scripts/research-cap.mts --keep=25 [--dry-run] [--skip-read]
//
// --dry-run reads the unread papers (that writes agent recommendations only,
// never a review decision) and prints what the cut would keep, without
// dismissing anything. --skip-read goes straight to the pick.

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`));
const keep = Number(arg('keep')?.split('=')[1] ?? 25);
const dryRun = !!arg('dry-run');
const skipRead = !!arg('skip-read');

const { readUnreadBatch, countUnreadPending, pickAndCap } = await import('../lib/research/queue-cap.ts');
const { q } = await import('../lib/db.ts');

if (!skipRead) {
  let left = await countUnreadPending();
  console.log(`unread: ${left}`);
  let stalls = 0;
  while (left > 0) {
    const r = await readUnreadBatch();
    console.log(`read ${r.processed}, failed chunks ${r.failed}, unread left ${r.remaining}`);
    stalls = r.processed === 0 ? stalls + 1 : 0;
    if (stalls >= 2) { console.error('the agent stopped making progress; stopping before the cut'); process.exit(1); }
    left = r.remaining;
  }
}

const r = await pickAndCap(keep, { dryRun });
console.log(JSON.stringify({ ...r, keepIds: undefined }, null, 2));
const kept = await q<{ title: string; rec: string | null; confidence: number | null }>(
  `select title, agent_recommendation::text as rec, agent_confidence as confidence
     from papers where id = any($1::uuid[])`,
  [r.keepIds]
);
for (const k of kept) console.log(`- [${k.rec ?? 'unread'} ${k.confidence ?? ''}] ${k.title}`);
console.log(dryRun ? '\ndry run: nothing dismissed' : `\ndismissed ${r.dismissed}`);
process.exit(0);

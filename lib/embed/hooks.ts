import { one, q } from '../db';
import { getEmbeddable, type EmbedKind } from './sources';
import { upsertEmbeddings } from './index';
import { embedBudgetAllows } from './budget';

export { embedBudgetAllows } from './budget';

// Incremental indexing hooks, called right after a record is created or its
// text changes so the embedding corpus tracks the Atlas without waiting on a
// nightly backfill. Every call site is fire-and-forget (embedLater never
// throws into its caller) and must run AFTER the writing transaction
// commits, never inside withTx: an embed write racing a rolled-back
// transaction would embed text that was never actually saved. A miss here
// (budget skip, transient failure) is caught later by the embeddings.missing
// agent check and its auto-tier backfill remedy.

const EMBED_FEATURES = ['embed_index'];

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export interface EmbedBudget {
  ok: boolean;
  spentUsd: number;
  capUsd: number;
}

export async function checkEmbedBudget(): Promise<EmbedBudget> {
  const capUsd = envNumber('EMBED_DAILY_BUDGET_USD', 0.25);
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd
       from ai_cost_log
      where feature = any($1::text[])
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    [EMBED_FEATURES]
  );
  const spentUsd = row?.usd ?? 0;
  return { ok: embedBudgetAllows(spentUsd, capUsd), spentUsd, capUsd };
}

// Fire-and-forget: embeds exactly the given record ids (a uuid for
// signal/candidate/scan_item/intel_item/intel_fact/paper, a code/slug for
// claim/bridge/stance/concept/thread). Never throws.
export function embedLater(kind: EmbedKind, ids: string[]): void {
  const trimmed = Array.from(new Set(ids.filter(Boolean)));
  if (!trimmed.length) return;
  void (async () => {
    try {
      const budget = await checkEmbedBudget();
      if (!budget.ok) {
        console.warn(`embedLater(${kind}): skipped ${trimmed.length} record(s), daily embed budget spent ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`);
        return;
      }
      const records = await getEmbeddable(kind, q, trimmed);
      if (records.length) await upsertEmbeddings(kind, records);
    } catch (e) {
      console.warn(`embedLater(${kind}) failed:`, e instanceof Error ? e.message : e);
    }
  })();
}

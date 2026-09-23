import type { FindingInput, FindingState } from './types';

// The pure decision core behind lib/mutations/agent.ts's upsertFindings.
// Split out into its own zero-runtime-import file (only `import type`s,
// erased by TypeScript, so plain Node type stripping can load this directly
// with no DB in the chain) so scripts/test-agent.mjs can exercise the
// reconciliation logic without a database.
//
// Given the currently-active rows and this run's checks, decide the four
// buckets upsertFindings needs to write: brand-new keys (insert), resolved
// findings a check fired on again (reopen), still-active findings to refresh
// in place (update; `unsnooze` when a snooze has expired), and active
// findings this run's checks never mentioned (resolve).

export interface ExistingFindingLite {
  key: string;
  state: FindingState;
  snoozed_until: string | null;
}

export interface FindingPlan {
  insert: FindingInput[];
  reopen: FindingInput[];
  update: { input: FindingInput; unsnooze: boolean }[];
  resolveKeys: string[];
}

export function reconcileFindings(
  existing: ExistingFindingLite[],
  inputs: FindingInput[],
  now: Date
): FindingPlan {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const inputKeys = new Set(inputs.map((i) => i.key));
  const insert: FindingInput[] = [];
  const reopen: FindingInput[] = [];
  const update: { input: FindingInput; unsnooze: boolean }[] = [];

  for (const input of inputs) {
    const ex = byKey.get(input.key);
    if (!ex) {
      insert.push(input);
      continue;
    }
    if (ex.state === 'resolved') {
      reopen.push(input);
      continue;
    }
    const unsnooze = ex.state === 'snoozed' && !!ex.snoozed_until && new Date(ex.snoozed_until) <= now;
    update.push({ input, unsnooze });
  }

  const resolveKeys = existing
    .filter((e) => e.state !== 'resolved' && !inputKeys.has(e.key))
    .map((e) => e.key);

  return { insert, reopen, update, resolveKeys };
}

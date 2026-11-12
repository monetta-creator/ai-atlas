// The chat's monthly budget policy (redo Phase 1, Q6: about $10 a month).
// Pure and import-free: given this month's spend, the cap, what Auto wanted,
// and whether the person picked a model by hand, say which tier runs and what
// notice (if any) the answer carries. The DB read lives in budget.ts.
import type { Tier } from '../llm/models';

export const BUDGET_FEATURES = ['ask_answer', 'ask_decide', 'ask_enhance', 'ask_verify2'] as const;
export const DEFAULT_MONTHLY_CAP_USD = 10;
export const NO_ESCALATE_AT = 0.8; // past 80% of the cap Auto stops escalating

export interface BudgetState {
  spentUsd: number;
  capUsd: number;
}

export type BudgetNotice = null | 'auto_held' | 'auto_capped' | 'manual_over_cap';

export interface BudgetVerdict {
  tier: Tier;
  notice: BudgetNotice;
  // User-facing line for the notice (no em dashes).
  message: string | null;
  usedShare: number;
}

export function budgetVerdict(b: BudgetState, wanted: Tier, manual: boolean): BudgetVerdict {
  const cap = b.capUsd > 0 ? b.capUsd : DEFAULT_MONTHLY_CAP_USD;
  const used = Math.max(0, b.spentUsd) / cap;
  const spent = `$${b.spentUsd.toFixed(2)} of $${cap.toFixed(2)}`;
  if (manual) {
    if (used >= 1) return { tier: wanted, notice: 'manual_over_cap', message: `Past this month's chat budget (${spent}). Running your pick anyway.`, usedShare: used };
    return { tier: wanted, notice: null, message: null, usedShare: used };
  }
  if (used >= 1) {
    return { tier: 'cheap', notice: 'auto_capped', message: `This month's chat budget is used up (${spent}), so Auto stays on the cheapest model.`, usedShare: used };
  }
  if (used >= NO_ESCALATE_AT && wanted !== 'cheap') {
    return { tier: 'cheap', notice: 'auto_held', message: `Auto held to the cheap model: ${Math.round(used * 100)}% of this month's chat budget is spent (${spent}).`, usedShare: used };
  }
  return { tier: wanted, notice: null, message: null, usedShare: used };
}

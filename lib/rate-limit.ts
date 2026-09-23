// A pure, dependency-free failure-count limiter. Per-instance and best-effort
// on serverless (each warm Vercel instance holds its own Map; this blunts
// casual guessing, it is not a distributed defense) — mirrors the allow()
// idiom already used in app/api/access/request/route.ts and
// app/api/tickets/route.ts, generalized so lib/portal/identity.ts and its two
// sessionless callers can share ONE limiter instance for the legacy portal
// key. Counts FAILURES only (never successful or skipped attempts), so a
// caller decides for itself when a compare counted as a failure.

export interface Limiter {
  /** True when `key` may attempt a compare right now. */
  allow(key: string): boolean;
  /** Record a failed attempt for `key`. */
  fail(key: string): void;
  /** Clear `key`'s recorded failures (e.g. after a successful compare). */
  reset(key: string): void;
}

export interface LimiterOptions {
  /** Failures allowed within the window before allow() returns false. */
  max: number;
  windowMs: number;
  /** Injectable clock, for deterministic window-rollover tests. */
  now?: () => number;
}

export function createLimiter({ max, windowMs, now = () => Date.now() }: LimiterOptions): Limiter {
  const failures = new Map<string, number[]>();

  // Opportunistic pruning: only the key being touched is swept, on every
  // call, same as the access-request route's allow(). There is no global
  // sweep, so a key that stops being touched keeps its (eventually stale)
  // entry until it is touched again; acceptable for a per-instance, recycled
  // serverless map defending against a live guessing burst, not a ledger.
  function prune(key: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  }

  return {
    allow(key: string): boolean {
      return prune(key).length < max;
    },
    fail(key: string): void {
      const kept = prune(key);
      kept.push(now());
      failures.set(key, kept);
    },
    reset(key: string): void {
      failures.delete(key);
    },
  };
}

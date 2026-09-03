// Bounded rolling worker pool: keeps up to `concurrency` jobs in flight and
// starts the next one the moment a slot frees, instead of a synchronized
// Promise.all wave where every slot idles until the slowest job in the batch
// finishes. `shouldStart()` is checked before EVERY job start so a caller can
// drain the pool against a deadline without aborting in-flight work. Jobs
// never reject the pool: each result is settled (fulfilled or rejected).
//
// Items are started in index order (worker N always claims the next
// not-yet-started item), so the started items are always a prefix of
// `items`. `results[i]` corresponds to `items[i]` for every started item;
// `results` is exactly `started` long, so an item never started has no
// entry (rather than a synthetic 'not started' rejection).
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  job: (item: T, index: number) => Promise<R>,
  shouldStart: () => boolean = () => true,
): Promise<{ results: PromiseSettledResult<R>[]; started: number }> {
  const results: PromiseSettledResult<R>[] = [];
  let nextIndex = 0;
  let started = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length && shouldStart()) {
      const index = nextIndex;
      nextIndex += 1;
      started += 1;
      try {
        const value = await job(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { results: results.slice(0, started), started };
}

// Pure helpers shared by the two deterministic report cores
// (lib/tearsheet/pack-core.ts and lib/thesis/pack-core.ts). Zero imports, zero
// DB: both cores are driven from plain Node by the test scripts via injected
// query functions, so this module must stay loadable under Node's type
// stripping (hence the extensioned relative imports at its call sites, which
// tsconfig's allowImportingTsExtensions permits).

// The injected query seam: production passes lib/db's q(), the tests a pg client.
export type Q = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export function domainOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// 'YYYY Qn' quarter buckets over published dates, zero-filled across the span
// so a timeline reads continuously.
export function quarterBuckets(dates: (string | null)[]): { bucket: string; n: number }[] {
  const qs = dates
    .filter((d): d is string => !!d && /^\d{4}-\d{2}/.test(d))
    .map((d) => {
      const y = Number(d.slice(0, 4));
      const quarter = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
      return y * 4 + (quarter - 1);
    });
  if (!qs.length) return [];
  const counts = new Map<number, number>();
  for (const k of qs) counts.set(k, (counts.get(k) ?? 0) + 1);
  const min = Math.min(...qs);
  const max = Math.max(...qs);
  const out: { bucket: string; n: number }[] = [];
  for (let k = min; k <= max; k++) {
    out.push({ bucket: `${Math.floor(k / 4)} Q${(k % 4) + 1}`, n: counts.get(k) ?? 0 });
  }
  return out;
}

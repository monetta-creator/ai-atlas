// Pure anomaly detection for Savant's weekday notebook (2026-09-26):
// metric z-scores against the trailing window, volume spikes against the
// scan/intel weekly counts, and silent-lens detection over published
// signals. PLAIN-NODE LOADABLE: only a type import (erased) and an explicit
// `.ts` relative import of the metric registry.

import type { AnomalyPayload } from './types';
import { METRIC_BY_CODE, anomalyEligible } from './metric-codes.ts';
import type { MetricDef } from './metric-codes.ts';

// Thousands-separated; ratios/percents keep two decimals, everything else
// rounds to the nearest whole unit (dollars in thousands, counts).
function fmtNum(n: number, ratio = false): string {
  if (ratio) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(n).toLocaleString('en-US');
}

// Unit-aware: FDIC and Y-9C report dollars in THOUSANDS, EDGAR in dollars;
// the first live pass printed Citigroup as "$1.98 billion total assets against
// $1.55 trillion deposits" from the mix. Money renders in billions.
export function fmtMetric(n: number, unit: MetricDef['unit'] | null | undefined): string {
  switch (unit) {
    case 'usd_thousands': return `$${(n * 1000 / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
    case 'usd': return `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
    case 'percent': return `${fmtNum(n, true)}%`;
    case 'ratio': return fmtNum(n, true);
    case 'per_share': return fmtNum(n, true);
    case 'count': return fmtNum(n);
    default: return fmtNum(n, Math.abs(n) < 100 && !Number.isInteger(n));
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export function zScore(latest: number, history: number[]): { z: number; mean: number; sd: number } | null {
  if (history.length < 4) return null;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  return { z: (latest - mean) / sd, mean, sd };
}

export interface MetricSeries {
  company: string;
  code: string;
  points: { period: string; value: number }[];
}

export interface MetricAnomalyOpts {
  window?: number;         // trailing points of history (default 8)
  minZ?: number;           // default 2
  asOf?: string;           // YYYY-MM-DD; with freshDays, a series whose latest period is older is skipped
  freshDays?: number;      // default 120
  mode?: 'delta' | 'level'; // default 'delta': z of the latest period-over-period change vs trailing changes,
                            // so a bank whose balance sheet trends up every quarter is not an "anomaly"
  perCompany?: number;     // default 3
  max?: number;            // default 20
}

export function metricAnomalies(series: MetricSeries[], opts: MetricAnomalyOpts = {}): AnomalyPayload[] {
  const window = opts.window ?? 8;
  const minZ = opts.minZ ?? 2;
  const mode = opts.mode ?? 'delta';
  const freshDays = opts.freshDays ?? 120;
  const out: AnomalyPayload[] = [];

  for (const s of series) {
    if (!anomalyEligible(s.code)) continue;
    const points = [...s.points].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    if (points.length === 0) continue;
    const latestPoint = points[points.length - 1];
    if (opts.asOf && daysBetween(latestPoint.period, opts.asOf) > freshDays) continue;

    let z: ReturnType<typeof zScore>;
    if (mode === 'delta') {
      const values = points.slice(Math.max(0, points.length - 2 - window)).map((p) => p.value);
      const deltas = values.slice(1).map((v, i) => v - values[i]);
      if (deltas.length < 5) continue;
      z = zScore(deltas[deltas.length - 1], deltas.slice(0, -1));
    } else {
      const history = points.slice(Math.max(0, points.length - 1 - window), points.length - 1).map((p) => p.value);
      z = zScore(latestPoint.value, history);
    }
    if (!z || Math.abs(z.z) < minZ) continue;

    const def = METRIC_BY_CODE[s.code];
    const label = def?.label ?? s.code;
    const unit = def?.unit ?? null;
    const roundedZ = Math.round(z.z * 100) / 100;
    const prev = points.length >= 2 ? points[points.length - 2].value : null;
    const levelMean = points.slice(Math.max(0, points.length - 1 - window), points.length - 1).reduce((a, p) => a + p.value, 0) / Math.max(1, Math.min(window, points.length - 1));
    const note = mode === 'delta' && prev != null
      ? `${label} for ${s.company} moved to ${fmtMetric(latestPoint.value, unit)} in ${latestPoint.period} from ${fmtMetric(prev, unit)}, a ${
          z.z > 0 ? 'larger rise' : 'larger fall'
        } than any of its trailing ${window} changes (${Math.abs(roundedZ)}σ against them)`
      : `${label} for ${s.company} is ${fmtMetric(latestPoint.value, unit)} in ${latestPoint.period}, ${
          z.z > 0 ? 'above' : 'below'
        } its trailing mean of ${fmtMetric(z.mean, unit)} (${Math.abs(roundedZ)}σ)`;

    out.push({
      kind: 'metric',
      subject: s.company,
      label,
      latest: latestPoint.value,
      baseline: mode === 'delta' ? levelMean : z.mean,
      z: roundedZ,
      period: latestPoint.period,
      unit,
      source: def?.source,
      note,
    });
  }
  // Loudest first; one entry per (company, label family), since FDIC, Y-9C
  // and EDGAR each carry a "Total assets" series for the same bank; at most
  // `perCompany` per company and `max` overall.
  out.sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0));
  const perCompany = opts.perCompany ?? 3;
  const seen = new Map<string, number>();
  const families = new Set<string>();
  const capped: AnomalyPayload[] = [];
  for (const a of out) {
    const family = `${a.subject}|${a.label.replace(/\s*\(holding co\.\)/i, '').replace(/^total /i, '').toLowerCase()}`;
    if (families.has(family)) continue;
    const n = seen.get(a.subject) ?? 0;
    if (n >= perCompany) continue;
    families.add(family);
    seen.set(a.subject, n + 1);
    capped.push(a);
    if (capped.length >= (opts.max ?? 20)) break;
  }
  return capped;
}

export interface VolumeAnomalyOpts {
  minZ?: number;
  minLatest?: number;
}

export function volumeAnomalies(
  current: Record<string, number>,
  trailing: Record<string, number[]>,
  kind: 'volume_topic' | 'volume_company',
  labels: Record<string, string>,
  opts: VolumeAnomalyOpts = {}
): AnomalyPayload[] {
  const minZ = opts.minZ ?? 2;
  const minLatest = opts.minLatest ?? 5;
  const source = kind === 'volume_topic' ? 'scan' : 'intel';
  const out: AnomalyPayload[] = [];

  for (const key of Object.keys(current)) {
    const latest = current[key];
    if (latest < minLatest) continue;
    const z = zScore(latest, trailing[key] ?? []);
    if (!z || Math.abs(z.z) < minZ) continue;

    const label = labels[key] ?? key;
    const roundedZ = Math.round(z.z * 100) / 100;
    const note = `${label} volume is ${fmtNum(latest)} this week, ${z.z > 0 ? 'above' : 'below'} its trailing mean of ${fmtNum(
      z.mean
    )} (${Math.abs(roundedZ)}σ)`;

    out.push({ kind, subject: key, label, latest, baseline: z.mean, z: roundedZ, source, note });
  }

  return out.sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

export function silentLenses(counts: Record<string, number>, lenses: string[]): AnomalyPayload[] {
  return lenses
    .filter((lens) => (counts[lens] ?? 0) === 0)
    .map((lens) => ({
      kind: 'lens_silent',
      subject: lens,
      label: lens,
      latest: 0,
      baseline: 0,
      note: `No published signal touched the ${lens} lens this week`,
    }));
}

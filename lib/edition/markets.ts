import type { EditionMarketRow } from './types';

// The market strip: an AI basket priced at edition time. Source: Yahoo
// Finance's public chart endpoint, which answers without a key but is not
// a documented API (Stooq, the first choice, sits behind a bot wall as of
// 2026-09-23). One request per symbol, 8s each, run in parallel; a failed
// symbol is dropped and a strip with fewer than 4 rows is omitted entirely,
// so a source outage costs the paper one line, never the edition.

export const MARKET_BASKET: { symbol: string; label: string }[] = [
  { symbol: 'NVDA', label: 'Nvidia' },
  { symbol: 'MSFT', label: 'Microsoft' },
  { symbol: 'GOOGL', label: 'Alphabet' },
  { symbol: 'META', label: 'Meta' },
  { symbol: 'AMZN', label: 'Amazon' },
  { symbol: 'TSM', label: 'TSMC' },
  { symbol: 'SOXX', label: 'Semis (SOXX)' },
  { symbol: 'XLU', label: 'Utilities (XLU)' },
];

interface ChartResponse {
  chart?: {
    result?: {
      meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketTime?: number; chartPreviousClose?: number };
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export function parseChart(symbol: string, label: string, json: ChartResponse): EditionMarketRow | null {
  const r = json.chart?.result?.[0];
  const price = r?.meta?.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  let changePct = r?.meta?.regularMarketChangePercent;
  if (typeof changePct !== 'number') {
    const prev = r?.meta?.chartPreviousClose ?? closes[closes.length - 2];
    changePct = typeof prev === 'number' && prev > 0 ? ((price - prev) / prev) * 100 : 0;
  }
  return { symbol, label, price, changePct, spark: closes.slice(-22) };
}

export async function fetchMarketStrip(timeoutMs = 8000): Promise<{ asOf: string; rows: EditionMarketRow[] } | null> {
  const rows = await Promise.all(
    MARKET_BASKET.map(async ({ symbol, label }) => {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (AI Atlas edition)' }, signal: AbortSignal.timeout(timeoutMs) }
        );
        if (!res.ok) return null;
        return parseChart(symbol, label, (await res.json()) as ChartResponse);
      } catch {
        return null;
      }
    })
  );
  const ok = rows.filter((r): r is EditionMarketRow => r !== null);
  if (ok.length < 4) return null;
  return { asOf: new Date().toISOString(), rows: ok };
}

export function fmtChange(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

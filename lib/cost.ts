import { one, exec } from './db';
import type { RateCard } from './types';

// Server-only AI cost monitoring (migration 0014). Every successful Anthropic call in the
// app routes through recordApiCall: it prices the call from the THEN-ACTIVE rate card,
// freezes the cost, and writes one ai_cost_log row. The whole thing is wrapped so a logging
// failure can NEVER surface to the user or break the AI feature (telemetry is best-effort).
//
// The three call sites are lib/dossier.ts (generateDossier + the shared runStructured) and
// lib/pipeline/web.ts (searchCandidates) — instrument those and every feature is covered.

// The minimal shape we read off an Anthropic message's `usage`. Cache fields and the
// server-tool block are optional/nullable depending on the call.
interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

// Feature slugs are written to ai_cost_log.feature; their human labels live in lib/format.ts
// (featureLabel) so client dashboards can import them without pulling in this server-only file.

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// The active card for a model is the one with the latest effective_date that is on-or-before
// `asOf` (default: today). A card with a FUTURE effective date is not active yet. Returns
// null when no card covers the model (recordApiCall then logs the call with cost 0).
async function getActiveRateCard(model: string, asOf?: string): Promise<RateCard | null> {
  const cutoff = asOf ? '$2::date' : 'current_date';
  return one<RateCard>(
    `select id, model, effective_date::text as effective_date,
            input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok,
            context_window, created_at::text as created_at
       from ai_rate_cards
      where model = $1 and effective_date <= ${cutoff}
      order by effective_date desc
      limit 1`,
    asOf ? [model, asOf] : [model]
  );
}

// Pure: cost in USD for one call. Rates are per MILLION tokens.
function computeCostUsd(
  t: { input: number; output: number; cacheWrite: number; cacheRead: number },
  rate: RateCard
): number {
  const M = 1_000_000;
  return (
    (t.input / M) * rate.input_per_mtok +
    (t.output / M) * rate.output_per_mtok +
    (t.cacheWrite / M) * rate.cache_write_per_mtok +
    (t.cacheRead / M) * rate.cache_read_per_mtok
  );
}

// Price + log one Anthropic call. NEVER throws — any failure (no rate card, DB down, bad
// usage) is swallowed so the AI feature is unaffected. Awaited by callers so the row lands
// before the serverless function returns; the insert is one cheap pooled round-trip.
export async function recordApiCall(opts: {
  feature: string;
  model: string;
  usage: ApiUsage | null | undefined;
  wallMs: number;
  pipelineRunId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const u = opts.usage ?? {};
    const input = num(u.input_tokens);
    const output = num(u.output_tokens);
    const cacheWrite = num(u.cache_creation_input_tokens);
    const cacheRead = num(u.cache_read_input_tokens);

    // Server-tool web searches bill ~$10 per 1,000 requests ON TOP of tokens;
    // the token rate card can't price them, so a flat per-search surcharge
    // folds into the frozen cost (and thereby into the portal's daily budget).
    const WEB_SEARCH_USD = 0.01;
    const webSearches = num(u.server_tool_use?.web_search_requests);
    const rate = await getActiveRateCard(opts.model);
    const cost =
      (rate ? computeCostUsd({ input, output, cacheWrite, cacheRead }, rate) : 0) +
      webSearches * WEB_SEARCH_USD;

    // Utilization = total input context (uncached + cache write + cache read) / window.
    // Clamp to [0,100]: a successful call's prompt always fits the window.
    const totalInput = input + cacheWrite + cacheRead;
    const contextPct =
      rate && rate.context_window > 0
        ? Math.min(100, Math.max(0, (totalInput / rate.context_window) * 100))
        : null;

    const metadata: Record<string, unknown> = { ...(opts.metadata ?? {}) };
    if (webSearches > 0) metadata.web_search_requests = webSearches;

    await exec(
      `insert into ai_cost_log
         (feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          wall_ms, context_pct, cost_usd, rate_card_id, pipeline_run_id, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        opts.feature,
        opts.model,
        input,
        output,
        cacheRead,
        cacheWrite,
        Math.max(0, Math.round(opts.wallMs)),
        contextPct,
        cost,
        rate?.id ?? null,
        opts.pipelineRunId ?? null,
        JSON.stringify(metadata),
      ]
    );
  } catch {
    // Telemetry is best-effort: a logging failure must never break the AI call or reach the user.
  }
}

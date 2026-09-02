import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { COVERAGE_QUERIES, BREAKING_SWEEP_DOMAINS, MAX_SEARCH_USES, resolveDateTokens } from './config';
import { coverageDevelopmentsGdelt, coverageDevelopmentsTavily } from './search';
import { gdeltAvailable } from '../scan/search-gdelt';
import { getRun, getCandidates, getSignalsDigestForTriage, getPipelinePrefs } from '../data';
import * as m from '../mutations';
import type { CoverageDevelopment, RunCoverage } from '../types';

// The post-run coverage check — the audit step born from the Kimi K3 miss (a frontier
// release sat in Bloomberg/CNBC/TechCrunch for three days and the run surfaced none of
// them, silently). One web-enabled call re-derives "the most significant AI developments
// since the window opened" with query phrasing INDEPENDENT of discovery's (so it is a
// real check, not a rubber stamp), then marks each development covered or missed against
// the run's own candidates plus the existing signals. Advisory: the result is persisted
// on the run row and shown on /pipeline; a failure here never fails the run.

const MODEL = 'claude-sonnet-4-6';

// Keep the tracked-items block bounded: a run can have 300+ candidates and the digest
// carries 200 signal titles; both fit comfortably, but cap defensively anyway.
const MAX_TRACKED_LINES = 600;

export async function runCoverageCheck(runId: string): Promise<RunCoverage> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the coverage check.');
  const run = await getRun(runId);
  if (!run) throw new Error('Run not found.');

  // Re-derive the run's window from its own row (the client does not have to replay
  // sinceISO for resumed runs). Slightly wider than the original window when the run
  // was capped by "since the last run" — wider only makes the check stricter.
  const lookbackDays = run.cadence === 'daily' ? 1 : 7;
  const sinceISO = new Date(new Date(run.triggered_at).getTime() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [candidates, digest] = await Promise.all([getCandidates(runId), getSignalsDigestForTriage()]);
  const tracked = [
    ...digest.signals.map((s) => s.title),
    ...candidates.map((c) => c.headline || c.url),
  ]
    .filter(Boolean)
    .slice(0, MAX_TRACKED_LINES);

  const queries = resolveDateTokens(COVERAGE_QUERIES, sinceISO);

  // 2.0: GDELT (keyless, free) fetches the quality outlets' headlines and the cheap
  // utility model does the covered-vs-missed comparison. GDELT has proven unreliable
  // in production (2026-09-02), so the call is guarded by its circuit breaker
  // (gdeltAvailable, lib/scan/search-gdelt) and falls back to the Tavily version of the
  // same recipe when TAVILY_API_KEY is set; with neither a working GDELT nor a Tavily
  // key, the error rethrows (the caller's existing "coverage check failed" note handles
  // it). The Sonnet web_search call below is the fallback when OPENROUTER_API_KEY is
  // absent. Same RunCoverage shape either way.
  if (process.env.OPENROUTER_API_KEY) {
    const prefs = await getPipelinePrefs();
    let developments;
    try {
      if (!gdeltAvailable()) throw new Error('gdelt circuit open');
      developments = await coverageDevelopmentsGdelt({
        queries, sinceISO, tracked, pipelineRunId: runId, utilityModel: prefs.utility_model,
      });
    } catch (e) {
      if (!process.env.TAVILY_API_KEY) throw e;
      developments = await coverageDevelopmentsTavily({
        queries, sinceISO, tracked, pipelineRunId: runId, utilityModel: prefs.utility_model,
      });
    }
    const coverage: RunCoverage = {
      since: sinceISO,
      checked_at: new Date().toISOString(),
      developments: developments.slice(0, 12),
    };
    await m.setRunCoverage(runId, coverage);
    return coverage;
  }

  const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: MAX_SEARCH_USES,
      allowed_domains: BREAKING_SWEEP_DOMAINS,
    },
    {
      name: 'submit_coverage',
      description: 'Return the most significant AI developments and whether each is already tracked.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          developments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                headline: { type: 'string' },
                url: { type: 'string' },
                covered: { type: 'boolean' },
                matched: { type: 'string' },
              },
              required: ['headline', 'url', 'covered', 'matched'],
            },
          },
        },
        required: ['developments'],
      },
    },
  ];

  const user = `You audit an AI-economy intelligence pipeline run for coverage gaps. Search the web for the most significant AI developments published since ${sinceISO}: frontier or open-weight model releases and major capability jumps, major AI lab or government announcements, major regulatory or export-control actions, and major AI market or infrastructure events.
Run these web searches (one at a time):
${queries.map((q) => `- ${q}`).join('\n')}

Then compare what you found against the TRACKED ITEMS below (this run's discovered candidates plus the board's existing signals). Call submit_coverage with the 5 to 8 most significant developments; for each set covered=true only when a tracked item clearly reports the same story (put that item's text in matched), otherwise covered=false with matched ''. Never use an em dash in any text you return.

TRACKED ITEMS:
${tracked.map((t) => `- ${t}`).join('\n')}`;

  const params = {
    model: MODEL,
    max_tokens: 4000,
    tools,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  };
  const t0 = Date.now();
  const msg = (await client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0]
  )) as Anthropic.Message;
  await recordApiCall({
    feature: 'pipeline_coverage',
    model: MODEL,
    usage: msg.usage,
    wallMs: Date.now() - t0,
    pipelineRunId: runId,
    metadata: { tracked: tracked.length },
  });

  const tu = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_coverage'
  );
  const raw = tu ? (tu.input as { developments?: CoverageDevelopment[] }).developments ?? [] : [];
  const developments: CoverageDevelopment[] = raw
    .filter((d) => d && typeof d.headline === 'string' && d.headline.trim())
    .slice(0, 12)
    .map((d) => ({
      headline: d.headline.trim().slice(0, 300),
      url: typeof d.url === 'string' && /^https?:\/\//i.test(d.url) ? d.url.trim() : '',
      covered: !!d.covered,
      matched: String(d.matched ?? '').trim().slice(0, 300),
    }));

  const coverage: RunCoverage = {
    since: sinceISO,
    checked_at: new Date().toISOString(),
    developments,
  };
  await m.setRunCoverage(runId, coverage);
  return coverage;
}

import { runStructured } from '../dossier';
import { chatJSONOpenRouter } from './llm';
import { DEFAULT_UTILITY_MODEL } from '../pipeline/config';
import { upsertSourceTiers, stampSourceTiers } from '../mutations/scan';
import { getUnstampedDomains, type SourceTierTable } from '../data/scan';
import { rateDomainByRule, SOURCE_KINDS } from './source-tiers';
import { acceptDomainRatings, type RatingCandidate } from './source-rating-core';

export { acceptDomainRatings, type RatingCandidate, type RatedDomainRow } from './source-rating-core';

// The once-per-domain model rating that fills in what the rules in
// source-tiers.ts don't cover (see the WHY note at the top of that file).
// Two provider paths, same prompt, same validation, mirroring
// lib/scan/enrich.ts: the picker's OpenRouter utility model when
// OPENROUTER_API_KEY is set, else the Haiku baseline via runStructured. Cost
// log discipline: feature 'scan_source_rating', provenance in metadata
// (scan_run / intel_run), NEVER pipelineRunId (the ai_cost_log FK trap).

// 25 per call: 40 overran the token cap on the qwen path (unterminated JSON, 2026-09-02 backfill).
const MAX_DOMAINS_PER_CALL = 25;
// The cross-model retry (the 0047 enrich pattern): a 429 or a truncated reply
// on the utility model rarely repeats on the fallback in the same minute.
const FALLBACK_RATING_MODEL = 'deepseek/deepseek-v4-flash';
const RATING_MODEL = 'claude-haiku-4-5';
const MAX_HEADLINE_CHARS = 200;

const KIND_DEFS = `regulator    government, central banks, supervisors, courts, statistics agencies
primary      the company or lab itself: newsrooms, IR pages, official blogs
research     research houses, pollsters, academic and policy institutes
wire         Reuters, AP, AFP and similar wire services
major        national and international news organizations
trade        sector trade press (banking, payments, fintech, legal)
tech_press   technology press
general      regional and general-interest outlets of unknown quality
aggregator   syndication and aggregation front ends
pr_wire      press-release distribution wires
blog         blogging platforms and personal sites
social       social networks and forums
promo        stock-tip, crypto-promo, SEO and content-farm sites
unknown      you genuinely cannot tell what this domain is`;

const SYSTEM = `You rate the RELIABILITY of news and content domains for a financial services and technology intelligence system. For each domain you receive, with one sample headline it produced, classify it into exactly one KIND and a reliability TIER from 1 (most reliable) to 4 (least reliable).

KINDS:
${KIND_DEFS}

Tier anchors by kind: regulator, primary, research, and wire default to tier 1. major, trade, and tech_press default to tier 2. general, aggregator, blog, pr_wire, and unknown default to tier 3. social and promo default to tier 4.

You may rate a domain one tier WORSE than its kind's default when you recognize a known-weak instance of that kind (a tabloid dressed as a major outlet, a content farm dressed as a trade magazine). Never rate a domain BETTER than its kind's default tier. When you genuinely cannot tell what a domain is, use kind "unknown" at tier 3 rather than guessing a stronger kind.

Give a one-sentence reason for the kind and tier you chose, grounded in what the domain and its sample headline suggest. Never use an em dash in any text you write.`;

function domainListText(candidates: RatingCandidate[]): string {
  return candidates
    .map((c) => `${c.domain} :: ${(c.sample_headline ?? '(no sample headline)').slice(0, MAX_HEADLINE_CHARS)}`)
    .join('\n');
}

function ratingSchema(domains: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            domain: { type: 'string', enum: domains },
            kind: { type: 'string', enum: [...SOURCE_KINDS] },
            tier: {
              type: 'integer',
              description:
                '1 (most reliable) to 4 (least reliable). Follow the tier anchors by kind in the system prompt: you may go one tier WORSE than the kind default for a known-weak instance, never better.',
            },
            reason: { type: 'string', description: 'One sentence explaining the kind and tier chosen.' },
          },
          required: ['domain', 'kind', 'tier', 'reason'],
        },
      },
    },
    required: ['ratings'],
  };
}

// One bounded call rating at most MAX_DOMAINS_PER_CALL domains. Throws on a model/network
// failure (the caller, rateAndStampSources, catches it and turns it into a
// run note); never throws on a malformed model reply, which just yields
// fewer accepted rows.
export async function rateDomainsWithModel(
  candidates: RatingCandidate[],
  opts: { utilityModel?: string | null; metadata?: Record<string, unknown> } = {}
): Promise<number> {
  if (!candidates.length) return 0;
  const batch = candidates.slice(0, MAX_DOMAINS_PER_CALL);
  const domains = batch.map((c) => c.domain);
  const metadata = { ...(opts.metadata ?? {}), domains: batch.length };
  const user = `DOMAINS TO RATE (one per line, "domain :: sample headline"):\n${domainListText(batch)}`;

  const openRouterCall = (model: string) =>
    chatJSONOpenRouter<{ ratings?: unknown[] }>({
        model,
        system: `${SYSTEM}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly one key:
  "ratings": array of objects {"domain": one of the exact domains listed, "kind": one of ${SOURCE_KINDS.join(', ')}, "tier": integer 1 to 4, "reason": one sentence}`,
        user,
        maxTokens: 4000,
        timeoutMs: 45_000,
        feature: 'scan_source_rating',
        metadata: { ...metadata, model },
      });
  const primary = opts.utilityModel ?? DEFAULT_UTILITY_MODEL;
  const raw = process.env.OPENROUTER_API_KEY
    ? await openRouterCall(primary).catch((e) => {
        if (primary === FALLBACK_RATING_MODEL) throw e;
        return openRouterCall(FALLBACK_RATING_MODEL);
      })
    : await runStructured<{ ratings?: unknown[] }>({
        system: SYSTEM,
        user,
        toolName: 'submit_source_ratings',
        toolDescription: 'Return the reliability rating for every listed domain.',
        schema: ratingSchema(domains),
        maxTokens: 4000,
        effort: 'low',
        feature: 'scan_source_rating',
        metadata,
        timeoutMs: 45_000,
        maxRetries: 0,
        model: RATING_MODEL,
      });

  const rows = acceptDomainRatings(raw as { ratings?: unknown[] }, batch);
  if (!rows.length) return 0;
  return upsertSourceTiers(rows);
}

// Stamp a run's (or the whole table's) items from rules + the source_tiers
// table, then rate whatever the rules genuinely don't cover, up to maxCalls
// batches of MAX_DOMAINS_PER_CALL, and stamp once more. Never throws: a model failure is
// caught and reported as a note so hydrate is never blocked by it.
export async function rateAndStampSources(
  table: SourceTierTable,
  runId: string | null,
  opts: {
    utilityModel?: string | null;
    budgetOk: () => Promise<boolean>;
    metadata?: Record<string, unknown>;
    maxCalls?: number;
  }
): Promise<{ stamped: number; rated: number; note: string | null }> {
  let stamped = await stampSourceTiers(table, runId);
  const unrated = (await getUnstampedDomains(table, runId, 200)).filter(
    (d) => rateDomainByRule(d.domain) === null
  );

  let rated = 0;
  let attempted = 0;
  if (unrated.length && (await opts.budgetOk())) {
    const maxCalls = opts.maxCalls ?? 3;
    try {
      for (let call = 0; call < maxCalls && call * MAX_DOMAINS_PER_CALL < unrated.length; call++) {
        const batch = unrated.slice(call * MAX_DOMAINS_PER_CALL, (call + 1) * MAX_DOMAINS_PER_CALL);
        attempted += batch.length;
        rated += await rateDomainsWithModel(batch, { utilityModel: opts.utilityModel, metadata: opts.metadata });
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? 'error').slice(0, 160);
      return { stamped, rated, note: `source rating failed: ${msg}` };
    }
    if (rated) stamped += await stampSourceTiers(table, runId);
  }

  const left = Math.max(0, unrated.length - attempted);
  const parts: string[] = [];
  if (stamped || rated || left) {
    parts.push(`${stamped} stamped`);
    if (rated) parts.push(`${rated} domains model-rated`);
    if (left) parts.push(`${left} left unrated (budget)`);
  }
  return { stamped, rated, note: parts.length ? `sources: ${parts.join(', ')}` : null };
}

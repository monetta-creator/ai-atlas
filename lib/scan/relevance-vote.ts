import { runStructured } from '../dossier';
import { setScanItemRelevanceVotes } from '../mutations/scan';
import { MAX_INPUT_CHARS, RELEVANCE_RUBRIC } from './enrich';
import { clamp01, mergeVotes, missingVoters, type RelevanceVotes, type VoteSummary } from './ensemble';
import { chatJSONOpenRouter } from './llm';

// The relevance ensemble's vote leg (migration 0053). After enrichment, every
// other panel model gives a SCORE-ONLY read of the same item, on the exact
// same rubric and the same input clip as the enrichment pass, so its vote is
// comparable to the assigned model's read. lib/scan/run.ts's runEnrichUnit
// queues these right after a successful enrichment (a vote pool drains the
// queue beside the enrich pool); a per-run top-up and
// scripts/backfill-relevance-votes.mjs catch whatever an earlier call missed.
//
// Cost-log discipline matches every other scan call: feature
// 'scan_relevance_vote', provenance in metadata, never pipelineRunId.

interface ScanVoteItem {
  id: string;
  url: string;
  headline: string | null;
  source_domain: string | null;
  raw_content: string;
}

const SYSTEM = `You are the relevance-only pass of an external news scan for a financial services strategy team. Score ONLY relevance using the stated anchors; reply with a single JSON object {"relevance": number}. Never use an em dash.`;

const VOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relevance: { type: 'number', description: RELEVANCE_RUBRIC },
  },
  required: ['relevance'],
};

function userText(item: ScanVoteItem): string {
  return `ITEM
URL: ${item.url}
SOURCE: ${item.source_domain ?? ''}
HEADLINE: ${item.headline ?? ''}

TEXT:
${item.raw_content.slice(0, MAX_INPUT_CHARS)}`;
}

// One short call: the same rubric, the same clip, one field back. Never
// throws, a null return means the caller just leaves that voter missing.
export async function scoreRelevanceVote(
  item: ScanVoteItem,
  model: string,
  opts: { scanRunId?: string | null }
): Promise<number | null> {
  const user = userText(item);
  const metadata = { scan_run: opts.scanRunId ?? null, item_id: item.id, model };
  try {
    const raw = model === 'claude-haiku-4-5'
      ? await runStructured<{ relevance: number }>({
          system: SYSTEM,
          user,
          toolName: 'submit_vote',
          toolDescription: 'Return the relevance-only score for this item.',
          schema: VOTE_SCHEMA,
          maxTokens: 60,
          feature: 'scan_relevance_vote',
          metadata,
          timeoutMs: 30_000,
          maxRetries: 0,
          model,
        })
      : await chatJSONOpenRouter<{ relevance: number }>({
          model,
          // A bare score needs a small thinking budget (see lib/scan/llm.ts): reasoning
          // off made deepseek flip between 0.95 and 0.0 on the same text.
          reasoningTokens: 200,
          system: `${SYSTEM}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly this key:
  "relevance": number. ${RELEVANCE_RUBRIC}`,
          user,
          maxTokens: 60,
          timeoutMs: 30_000,
          feature: 'scan_relevance_vote',
          metadata,
        });
    return clamp01(raw.relevance);
  } catch {
    return null;
  }
}

// Cast whatever votes an item is still missing: merge the assigned model's
// own score into the map, call every other panel model in parallel, merge the
// non-null results, and persist if the map ends up with at least one vote.
// Returns null when there was nothing to cast (every panel model already has
// a vote).
export async function castMissingVotes(
  item: ScanVoteItem,
  panel: string[],
  assignedModel: string | null,
  assignedScore: number | null,
  existing: RelevanceVotes | null,
  opts: { scanRunId?: string | null }
): Promise<VoteSummary | null> {
  const base = assignedModel ? mergeVotes(existing, { [assignedModel]: assignedScore }) : mergeVotes(existing, {});
  const need = missingVoters(panel, base);
  if (!need.length) return null;
  const results = await Promise.all(need.map((m) => scoreRelevanceVote(item, m, opts)));
  const cast: Record<string, number> = {};
  need.forEach((m, i) => {
    const v = results[i];
    if (v !== null) cast[m] = v;
  });
  const votes = mergeVotes(base, cast);
  if (!Object.keys(votes).length) return null;
  return setScanItemRelevanceVotes(item.id, votes);
}

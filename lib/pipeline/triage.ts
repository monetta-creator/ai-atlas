import { runStructured } from '../dossier';
import { normalizeUrl } from '../text';
import * as m from '../mutations';
import { getPendingCandidates, countPendingCandidates, getSignalsDigestForTriage, getKnownUrls, getDomainStats } from '../data';
import type { SignalCandidate, TriageStatus } from '../types';

// Triage filters the candidate list down to what's worth analyzing. The client drives one
// bounded CHUNK per call (triageChunk) so each call stays short no matter how many
// candidates a run holds. Per chunk, two passes:
// (1) a deterministic already-tracked-URL dedup, then
// (2) one non-web structured call that dedups against existing signals and applies
// source-quality + relevance judgment. Writing decisions moves candidates out of
// 'pending', so repeated calls drain the queue (and resume a partially-triaged run).

const TRIAGE_SYSTEM = [
  'You triage candidate news items for an AI-economy intelligence board read by financial-institution analysts.',
  'For each candidate decide: "approved" (worth a closer look), "duplicate" (same story as an existing signal — name it), or "rejected".',
  'Reject when: the source is low quality (PR newswires, SEO content farms, marketing posts, thin aggregators/listicles), the item is off-lens, it is older than the window, or it merely rehashes prior coverage with nothing new.',
  'Approve primary sources and serious analysis: company filings, regulators, reputable outlets, research labs, think tanks, quality trade press.',
  'MATERIALITY OVERRIDE: if a candidate reports a plausibly major development (a frontier or open-weight model release, a major regulatory or export-control action, a major lab or government announcement) that NO existing signal covers, approve it even when the source is weak or an aggregator: the analysis step reads the full text and a human still gates publication. A weak source carrying a minor or already-covered story stays rejected. Judge the story, not only the carrier.',
  'Be decisive but not stingy — when a real development is plausibly material, approve it; the human makes the final call. Keep each reason to one short clause, and never use an em dash in it.',
].join(' ');

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          status: { type: 'string', enum: ['approved', 'rejected', 'duplicate'] },
          reason: { type: 'string' },
        },
        required: ['index', 'status', 'reason'],
      },
    },
  },
  required: ['decisions'],
};

// Max candidates per triage chunk. Two ceilings at once: keeps each decisions array within
// the output budget (no truncation -> no silent fail-close), and keeps each call's
// wall-clock (one model call + <=this many writes) well under the 60s cap.
const TRIAGE_CHUNK = 40;

// Process ONE chunk of pending candidates. The client (PipelineConsole) calls this in a
// loop until `remaining` hits 0 — each call is its own server action with a fresh 60s
// budget, so a run of any size triages reliably instead of timing out as one monolithic call.
export async function triageChunk(
  runId: string,
  chunkSize = TRIAGE_CHUNK
): Promise<{ processed: number; approved: number; rejected: number; duplicate: number; remaining: number }> {
  // Reflect the live step; also clears a prior 'failed'/error so resuming a stranded run
  // (a transient timeout shouldn't strand its candidates) flips it back to running.
  await m.updateRun(runId, { step: 'triage', status: 'running', error: null });

  const pending = await getPendingCandidates(runId, chunkSize);
  if (!pending.length) {
    await m.recomputeRunCounts(runId);
    return { processed: 0, approved: 0, rejected: 0, duplicate: 0, remaining: 0 };
  }

  let approved = 0;
  let rejected = 0;
  let duplicate = 0;

  // 1) deterministic pre-filter (this chunk): already-tracked-URL dedup.
  // Every URL already tracked (manual sources + drafted candidates), normalized. A candidate
  // URL in this set is a duplicate of something we already have — flag it WITHOUT spending a
  // model decision. Manual candidates (source_id set) are exempt: their URL IS the tracked source.
  const knownUrls = new Set((await getKnownUrls()).map(normalizeUrl));
  const toModel: SignalCandidate[] = [];
  for (const c of pending) {
    if (!c.source_id && c.url && knownUrls.has(normalizeUrl(c.url))) {
      await m.setTriage(c.id, 'duplicate', 'already tracked');
      duplicate++;
    } else {
      toModel.push(c);
    }
  }

  // 2) one non-web structured call over this chunk's survivors (indices local to the chunk)
  if (toModel.length) {
    const { signals, ratedSources } = await getSignalsDigestForTriage();
    const existing =
      signals
        .map((s) => `- ${s.title}${s.published_at ? ` (${s.published_at})` : ''}`)
        .join('\n') || '(none yet)';
    const rated =
      ratedSources.map((s) => `- ${s.outlet}: ${s.reliability_prior}/100`).join('\n') ||
      '(none rated yet)';
    // The funnel's own history with this chunk's domains (decided candidates only).
    // Repeatedly discovered + never approved = SEO churn the model should lean against;
    // a strong drafted record is a point in favor.
    const chunkDomains = new Set(
      toModel.map((c) => (c.source_domain || '').toLowerCase().replace(/^www\./, '')).filter(Boolean)
    );
    const track =
      (await getDomainStats().catch(() => []))
        .filter((s) => chunkDomains.has(s.domain))
        .map(
          (s) =>
            `- ${s.domain}: ${s.seen} discovered, ${s.approved} approved, ${s.drafted} drafted, ${s.duplicate} duplicates`
        )
        .join('\n') || '(no history yet)';
    const list = toModel
      .map(
        (c, i) =>
          `[${i}] (${c.context}) ${c.source_domain || '?'}${c.published_date ? ` · ${c.published_date}` : ''} — ${c.headline || c.url}\n    ${c.url}`
      )
      .join('\n');

    const out = await runStructured<{ decisions: { index: number; status: string; reason: string }[] }>({
      // The signals digest + reliability ratings are identical for every chunk of a run —
      // they ride in the SYSTEM block (cache_control'd by runStructured) so chunks 2..N
      // read them from the prompt cache. The chunk-specific track record + candidate
      // list stay in the user message.
      system: `${TRIAGE_SYSTEM}\n\nEXISTING SIGNALS (flag a candidate as "duplicate" if it is the same story):\n${existing}\n\nKNOWN SOURCE RELIABILITY (the author's prior ratings, 0–100 — weight these in your credibility judgment):\n${rated}`,
      user: `DOMAIN TRACK RECORD (this pipeline's own funnel history with these domains — many discovered with zero approved AND zero duplicates is low-value churn, lean reject unless the story itself is materially new; duplicates mean the domain carries real stories we already track, so do not hold them against it):\n${track}\n\nCANDIDATES (with publication date where known — reject items older than the lookback window):\n${list}`,
      toolName: 'submit_triage',
      toolDescription: 'Return a triage decision for every candidate index.',
      schema: TRIAGE_SCHEMA,
      maxTokens: 4000,
      effort: 'low',
      feature: 'pipeline_triage',
      pipelineRunId: runId,
      metadata: { candidates: toModel.length },
    });

    const byIndex = new Map((out.decisions ?? []).map((d) => [d.index, d]));
    const allowed = ['approved', 'rejected', 'duplicate'];
    for (let i = 0; i < toModel.length; i++) {
      const d = byIndex.get(i);
      const status: TriageStatus =
        d && allowed.includes(d.status) ? (d.status as TriageStatus) : 'rejected';
      const reason = d ? String(d.reason ?? '').slice(0, 300) : 'no decision returned';
      await m.setTriage(toModel[i].id, status, reason);
      if (status === 'approved') approved++;
      else if (status === 'duplicate') duplicate++;
      else rejected++;
    }
  }

  await m.recomputeRunCounts(runId);
  const remaining = await countPendingCandidates(runId);
  return { processed: pending.length, approved, rejected, duplicate, remaining };
}

import { runStructured } from '../dossier';
import { chatJSONOpenRouter } from '../scan/llm';
import { SCAN_ENRICH_MODELS } from '../scan/models';
import { fetchCandidateText, MIN_READABLE_CHARS } from './web';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL } from '../format';
import * as m from '../mutations';
import { getCandidate, getTargets, getSourceMeta } from '../data';
import type { AnalyzedSignal, Direction, Significance, SignalLens } from '../types';

const DIRECTIONS: Direction[] = ['supports', 'contradicts', 'neutral'];
const SONNET = 'claude-sonnet-4-6';

// Per-candidate analysis: fetch the page text, then a single non-web structured call
// (live claim list injected so claim_touches cite real codes) produces a draft signal
// proposal. One call per candidate — batching degrades claim_touches accuracy. The
// draft is saved unpublished (origin='pipeline'); a human reviews and publishes.
// proposed_reliability is a SUGGESTION returned to the UI — never written to the
// source's prior (the model never sets the prior; that guardrail holds).
//
// 2.0 A/B: `model` (an OpenRouter id from the /pipeline picker, assigned per
// candidate by the caller) routes the call through chatJSONOpenRouter with the
// same prompts + an explicit JSON contract; undefined or an Anthropic id keeps
// the Sonnet forced-tool path. Either way the coercion/allow-listing below
// never trusts the model for codes or enums, and signals.drafted_by records
// which model wrote the draft (the review queue's A/B evidence).

const ANALYSIS_SYSTEM = [
  'You analyze one source and produce a Signal Board entry for financial-institution analysts.',
  'Voice: a curated internal intelligence brief — factual, specific, no hype, no stance-taking.',
  'Be DESCRIPTIVE, not normative: explain what happened and where it lands structurally; do NOT say whether AI is good or bad, or whether to buy or sell.',
  'Title: short, declarative, factual (e.g. "Hyperscaler combined AI capex commitments reach $725B for 2026, up 36% YoY" — not "Big Tech makes massive AI bet").',
  'Summary: 2–4 sentences — what happened, what it means structurally, one sentence on the implication for a financial institution. No jargon.',
  'significance: high = materially moves or tests a claim on the Argument Map or is a genuine new data point on a contested question; medium = relevant context that confirms the picture; low = background. Give a one-sentence reason.',
  'lenses: one or more of the provided lens codes (the item may touch more than the one it was retrieved under).',
  'claim_touches: ONLY codes from the provided claim/bridge list that this specific development genuinely bears on — not merely thematically related. For each, set direction: "supports" (evidence FOR the claim), "contradicts" (evidence AGAINST it), or "neutral" (bears on it but does not cut either way), plus a one-sentence reason. Empty if none truly apply.',
  'proposed_reliability: 0–100, your suggested reliability prior for this SOURCE, as a suggestion only.',
  'Work only from the provided text. Do not fabricate facts, figures, or codes.',
  'Never use an em dash in your output; use a comma, a colon, or separate sentences instead.',
].join(' ');

function buildSchema(codes: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      significance: { type: 'string', enum: ['high', 'medium', 'low'] },
      significance_reason: { type: 'string' },
      lenses: { type: 'array', items: { type: 'string', enum: SIGNAL_LENS_SLUGS } },
      claim_touches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: codes.length ? { type: 'string', enum: codes } : { type: 'string' },
            direction: { type: 'string', enum: ['supports', 'contradicts', 'neutral'] },
            reason: { type: 'string' },
          },
          required: ['code', 'direction', 'reason'],
        },
      },
      proposed_reliability: { type: 'integer' },
    },
    required: [
      'title', 'summary', 'significance', 'significance_reason',
      'lenses', 'claim_touches', 'proposed_reliability',
    ],
  };
}

interface AnalysisResult {
  signalId: string;
  analysis: AnalyzedSignal;
}

export async function analyzeCandidate(candidateId: string, model?: string): Promise<AnalysisResult | null> {
  const cand = await getCandidate(candidateId);
  if (!cand) throw new Error('Candidate not found.');
  if (cand.triage_status !== 'approved') throw new Error('Candidate is not approved for analysis.');
  if (cand.signal_id) {
    // already analyzed — idempotent no-op (don't create a second draft)
    return null;
  }
  // reflect the live step for the admin status line (idempotent)
  await m.updateRun(cand.run_id, { step: 'analysis' });

  // 1) the readable text. The orchestrator hydrates it in a separate invocation
  // (hydrateCandidateAction — full 60s budget for slow hosts/PDFs) BEFORE calling analyze,
  // so this is normally a cache read. The inline fetch is a backstop only (manual flows
  // pre-set raw_content; old clients), kept on a tight budget so fetch + model still fit
  // one invocation. On failure we THROW (no catch): the orchestrator classifies it
  // (FetchFailure.terminal) and retries or flags 'unanalyzable' accordingly.
  let text = cand.raw_content;
  if (!text) {
    const fetched = await fetchCandidateText(cand.url, { timeoutMs: 8_000, allowFallback: false });
    text = fetched.text;
    await m.setCandidateRawContent(candidateId, text, fetched.via);
  }
  if (!text || text.length < MIN_READABLE_CHARS) {
    throw new Error('source page returned too little readable text to analyze');
  }

  // 2) structured analysis with the live claim/bridge list
  const { claims, bridges } = await getTargets();
  const targets = [...claims, ...bridges];
  const codes = targets.map((t) => t.code);
  const targetList = [
    ...claims.map((t) => `[${t.code}] (claim) ${t.statement}`),
    ...bridges.map((t) => `[${t.code}] (bridge-claim) ${t.statement}`),
  ].join('\n');
  const lensGuide = SIGNAL_LENS_SLUGS.map((s) => `[${s}] ${SIGNAL_LENS_LABEL[s]}`).join('\n');

  // For a manual upload (source_id set) enrich the prompt with the curated bibliography the
  // candidate row doesn't carry (outlet/author) — parity with the old manual proposer.
  let bib = '';
  if (cand.source_id) {
    const meta = await getSourceMeta(cand.source_id);
    bib = [meta?.outlet && `Outlet: ${meta.outlet}`, meta?.author && `Author: ${meta.author}`]
      .filter(Boolean)
      .join(' · ');
  }
  const sourceBlock =
    `\nSOURCE (${cand.source_domain || 'unknown'} · ${cand.url}):\nHeadline: ${cand.headline || '(none)'}` +
    (bib ? `\n${bib}` : '') +
    `\n\n${text}`;

  // The lens guide + target list live in the SYSTEM block (cache_control'd on the
  // Anthropic path), not the user message: they're identical for every candidate in a
  // run, so calls 2..N read the expensive prefix from the prompt cache instead of
  // re-billing it. Only the per-candidate source block rides in the user message.
  const system = [
    ANALYSIS_SYSTEM,
    `\nLENSES (use only these codes):\n${lensGuide}`,
    `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes for claim_touches):\n${targetList || '(none)'}`,
  ].join('\n');

  const registryEntry = model ? SCAN_ENRICH_MODELS.find((mm) => mm.id === model) : undefined;
  const openrouter = Boolean(model && !registryEntry?.anthropic);
  // An Anthropic id from the picker (the Haiku baseline) rides runStructured's
  // model override (which omits effort/thinking for Haiku); no model = Sonnet.
  const anthropicOverride = !openrouter && registryEntry?.anthropic ? model : undefined;
  const out = openrouter
    ? await chatJSONOpenRouter<AnalyzedSignal>({
        model: model as string,
        system: `${system}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly these keys:
  "title": string
  "summary": string
  "significance": "high" | "medium" | "low"
  "significance_reason": string, one sentence
  "lenses": array of lens code strings from the LENSES list
  "claim_touches": array of {"code": "<code from the claims list>", "direction": "supports" | "contradicts" | "neutral", "reason": "<one sentence>"} (empty array if none truly apply)
  "proposed_reliability": integer 0 to 100`,
        user: sourceBlock,
        maxTokens: 2000,
        timeoutMs: 45_000,
        feature: 'pipeline_analysis',
        pipelineRunId: cand.run_id,
        metadata: { candidate_id: candidateId, lens: cand.lens },
      })
    : await runStructured<AnalyzedSignal>({
        system,
        user: sourceBlock,
        toolName: 'submit_signal',
        toolDescription: 'Return the proposed Signal Board entry for this source.',
        schema: buildSchema(codes),
        maxTokens: 2000,
        effort: 'medium',
        feature: 'pipeline_analysis',
        pipelineRunId: cand.run_id,
        metadata: { candidate_id: candidateId, lens: cand.lens },
        // Bound the model leg and disable in-call SDK retries so one analyze call
        // provably fits its invocation. Retry is the orchestrator's job (a fresh
        // invocation, with the page text already cached).
        timeoutMs: 38_000,
        maxRetries: 0,
        ...(anthropicOverride ? { model: anthropicOverride } : {}),
      });

  // 3) coerce + allow-list everything (never trust the model for codes/enums).
  // deBracket: the target list displays codes as [2.3], and some open-weight
  // models copy the brackets verbatim (live-caught: qwen3.7-flash returned
  // "[7.4]" for every touch, so the allow-list silently dropped them all).
  const deBracket = (v: unknown): string => String(v ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');
  const validLens = new Set<string>(SIGNAL_LENS_SLUGS);
  const validCode = new Set(codes);
  const significance: Significance = (['high', 'medium', 'low'] as const).includes(
    out.significance as Significance
  )
    ? (out.significance as Significance)
    : 'medium';
  const lenses = Array.isArray(out.lenses)
    ? Array.from(
        new Set(
          out.lenses
            .map((l) => deBracket(l))
            .filter((l): l is SignalLens => validLens.has(l))
        )
      )
    : [];
  const validDir = new Set<Direction>(DIRECTIONS);
  const seen = new Set<string>();
  const claim_touches = Array.isArray(out.claim_touches)
    ? out.claim_touches
        .map((t) => (t ? { ...t, code: deBracket(t.code) } : t))
        .filter((t) => t && validCode.has(t.code) && !seen.has(t.code) && seen.add(t.code))
        .map((t) => ({
          code: t.code,
          direction: validDir.has(t.direction as Direction) ? (t.direction as Direction) : 'neutral',
          reason: String(t.reason ?? '').slice(0, 2000),
        }))
    : [];
  const proposed_reliability = Math.max(0, Math.min(100, Math.round(Number(out.proposed_reliability) || 0)));
  const analysis: AnalyzedSignal = {
    title: String(out.title ?? '').slice(0, 200) || (cand.headline ?? 'Untitled signal'),
    summary: String(out.summary ?? ''),
    significance,
    significance_reason: String(out.significance_reason ?? ''),
    lenses: lenses.length ? lenses : [cand.lens],
    claim_touches,
    proposed_reliability,
  };

  // 4) persist as a draft signal (origin=pipeline) and claim the candidate ATOMICALLY in one
  // transaction, so a retried or concurrent analyze call can never create a duplicate draft.
  // Manual uploads already have a curated source (cand.source_id) — reuse it (preserving its
  // reliability_prior/author/outlet) instead of ensure-ing a bare one; discovery candidates ensure.
  const sourceId = cand.source_id ?? (await m.ensureSource({
    url: cand.url,
    title: cand.headline,
    outlet: cand.source_domain,
  }));
  const signalId = await m.createDraftForCandidate(
    {
      title: analysis.title,
      summary: analysis.summary,
      significance: analysis.significance,
      lenses: analysis.lenses,
      claim_touches: analysis.claim_touches.map((t) => t.code),
      // Preserve the model's per-touch direction + reason; becomes evidence on publish.
      touch_details: Object.fromEntries(
        analysis.claim_touches.map((t) => [t.code, { direction: t.direction, reason: t.reason }])
      ),
      source_id: sourceId,
      published_at: cand.published_date || null,
      origin: cand.source_id ? 'manual' : 'pipeline',
      drafted_by: openrouter ? (model as string) : anthropicOverride ?? SONNET,
    },
    candidateId
  );
  if (!signalId) return null; // candidate was already claimed by an earlier/concurrent call
  await m.recomputeRunCounts(cand.run_id);

  return { signalId, analysis };
}

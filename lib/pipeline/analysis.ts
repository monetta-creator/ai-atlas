import { runStructured } from '../dossier';
import { MIN_READABLE_CHARS } from '../text';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL } from '../format';
import * as m from '../mutations';
import { getCandidate, getTargets, getSourceMeta } from '../data';
import type { AnalyzedSignal, Direction, Significance, SignalLens } from '../types';

const DIRECTIONS: Direction[] = ['supports', 'contradicts', 'neutral'];

// Per-candidate analysis: fetch the page text, then a single non-web structured call
// (live claim list injected so claim_touches cite real codes) produces a draft signal
// proposal. One call per candidate — batching degrades claim_touches accuracy. The
// draft is saved unpublished (origin='pipeline'); a human reviews and publishes.
// proposed_reliability is a SUGGESTION returned to the UI — never written to the
// source's prior (the model never sets the prior; that guardrail holds).

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

export async function analyzeCandidate(candidateId: string): Promise<AnalysisResult | null> {
  const cand = await getCandidate(candidateId);
  if (!cand) throw new Error('Candidate not found.');
  if (cand.triage_status !== 'approved') throw new Error('Candidate is not approved for analysis.');
  if (cand.signal_id) {
    // already analyzed — idempotent no-op (don't create a second draft)
    return null;
  }
  // reflect the live step for the admin status line (idempotent)
  await m.updateRun(cand.run_id, { step: 'analysis' });

  // 1) the readable text. There is no fetch leg any more: every candidate arrives
  // through manual/document intake with its text already retained (raw_content).
  // A candidate without enough retained text is unanalyzable by construction.
  const text = cand.raw_content;
  if (!text || text.length < MIN_READABLE_CHARS) {
    throw new Error('candidate has no retained text to analyze; re-add the source with its text');
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

  const out = await runStructured<AnalyzedSignal>({
    // The lens guide + target list live in the SYSTEM block (which runStructured marks
    // cache_control: ephemeral), not the user message: they're identical for every
    // candidate in a run, so calls 2..N of an analysis pass read the expensive prefix
    // (tools + system + claim list) from the prompt cache instead of re-billing it.
    // Only the per-candidate source block rides in the user message.
    system: [
      ANALYSIS_SYSTEM,
      `\nLENSES (use only these codes):\n${lensGuide}`,
      `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes for claim_touches):\n${targetList || '(none)'}`,
    ].join('\n'),
    user: sourceBlock,
    toolName: 'submit_signal',
    toolDescription: 'Return the proposed Signal Board entry for this source.',
    schema: buildSchema(codes),
    maxTokens: 2000,
    effort: 'medium',
    feature: 'pipeline_analysis',
    pipelineRunId: cand.run_id,
    metadata: { candidate_id: candidateId, lens: cand.lens },
    // Near the 60s cap (the backstop fetch can spend up to 8s; the normal path reads the
    // hydrated cache): bound the model leg to 38s and disable in-call SDK retries so one
    // analyze call provably fits. Retry is the orchestrator's job (a fresh invocation,
    // with the page text already cached).
    timeoutMs: 38_000,
    maxRetries: 0,
  });

  // 3) coerce + allow-list everything (never trust the model for codes/enums)
  const validLens = new Set<string>(SIGNAL_LENS_SLUGS);
  const validCode = new Set(codes);
  const significance: Significance = (['high', 'medium', 'low'] as const).includes(
    out.significance as Significance
  )
    ? (out.significance as Significance)
    : 'medium';
  const lenses = Array.isArray(out.lenses)
    ? Array.from(new Set(out.lenses.filter((l): l is SignalLens => validLens.has(l as string))))
    : [];
  const validDir = new Set<Direction>(DIRECTIONS);
  const seen = new Set<string>();
  const claim_touches = Array.isArray(out.claim_touches)
    ? out.claim_touches
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
    },
    candidateId
  );
  if (!signalId) return null; // candidate was already claimed by an earlier/concurrent call
  await m.recomputeRunCounts(cand.run_id);

  return { signalId, analysis };
}

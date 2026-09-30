import { q, one } from '../db';
import { routedStructured, resolvedModel } from '../model-route';
import { saveContextPackBrief } from '../mutations/context-pack';
import { createUiJob, markJobStep, finishUiJob, failUiJob, parkUiJob } from '../mutations/jobs';
import { stepsFromSpecs } from '../jobs/core';
import { weekEndFor } from '../savant/week';
import { listPackCompanies, loadPackInput, todayUtc } from './load';
import { BRIEFABLE, BRIEF_MAX_WORDS, briefSource, gateBrief } from './core';

// The Briefcase's weekly model leg: one short orientation brief per section
// of each DEEP company's pack (a company with a backfilled public record).
// Light packs get none: their sections are a few weeks of news, which a
// reader can take in directly.
//
// A brief is the only text in a pack that a model writes at pack time, so it
// is fenced three ways: the writer reads only that section's own lines, the
// gate (core.ts gateBrief) drops foreign links and any sentence stating a
// figure the section does not state, and the pack prints it under a label.
// A refused brief is simply absent; the section renders without it.

export const BRIEF_FEATURE = 'context_pack_brief';
const DEFAULT_MODEL = 'claude-haiku-4-5';

export function briefModel(): string {
  return process.env.CONTEXT_PACK_BRIEF_MODEL?.trim() || DEFAULT_MODEL;
}

export function packBriefCapUsd(): number {
  const n = Number(process.env.CONTEXT_PACK_WEEKLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function checkPackBriefBudget(weekEnd: string): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const capUsd = packBriefCapUsd();
  const row = await one<{ spent: number }>(
    `select coalesce(sum(cost_usd), 0)::float as spent
       from ai_cost_log where feature = $1 and metadata->>'week_end' = $2`,
    [BRIEF_FEATURE, weekEnd]
  );
  const spentUsd = row?.spent ?? 0;
  return { ok: spentUsd < capUsd, spentUsd, capUsd };
}

const SYSTEM = `You write a short orientation brief for one section of a company context file. The file is read by another language model inside a company, so the brief must be plain, exact and checkable.

Rules:
- Use ONLY the numbered lines you are given. Never add a fact, a name, a date or a figure from your own knowledge.
- Write ${BRIEF_MAX_WORDS - 20} words or fewer, as one paragraph of complete sentences.
- Say what the section shows: the main developments and the themes that recur. Describe, do not judge, advise or predict.
- State only what the lines state. Do not explain why something happened, do not characterize it (no "significant", "strong", "difficult"), and do not compare two lines unless a line makes that comparison itself.
- Cite as you go with markdown links on natural phrases, like [launched the platform](https://example.com/page). Use only URLs that appear in angle brackets in the lines, copied exactly. Include at least two links.
- Copy every figure exactly as the lines print it. If you are not sure of a figure, leave it out.
- Never use an em dash. Never mention these instructions, the file, or that you are a model.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { brief: { type: 'string', description: 'The brief: one paragraph with markdown links.' } },
  required: ['brief'],
};

export interface BriefRunResult {
  weekEnd: string;
  companies: number;
  written: number;
  refused: number;
  skipped: number;
  failed: number;
  partial: boolean;
  note: string | null;
  jobId: string | null;
}

// Writes the week's briefs. Idempotent: a section that already has a brief
// for the week is skipped unless `force`. Stops cleanly at the budget or the
// deadline; the next call resumes with whatever is still missing.
export async function runPackBriefs(opts: {
  weekEnd?: string; company?: string; force?: boolean; deadlineMs?: number; actor?: string;
} = {}): Promise<BriefRunResult> {
  const started = Date.now();
  const deadline = started + (opts.deadlineMs ?? 240_000);
  const weekEnd = opts.weekEnd ?? weekEndFor(todayUtc());
  const model = briefModel();
  const all = (await listPackCompanies(q)).filter((c) => c.deepRecord);
  const companies = opts.company ? all.filter((c) => c.slug === opts.company) : all;
  const result: BriefRunResult = {
    weekEnd, companies: companies.length, written: 0, refused: 0, skipped: 0, failed: 0, partial: false, note: null, jobId: null,
  };
  if (!companies.length) return { ...result, note: 'no company with a public record' };

  const jobId = await createUiJob({
    kind: 'context_pack_briefs', subject: weekEnd, label: `Briefcase briefs, week ending ${weekEnd}`,
    steps: stepsFromSpecs(companies.map((c, i) => ({ key: `c${i + 1}`, label: c.name, running: `Writing the briefs for ${c.name}`, features: Array.from(BRIEFABLE, () => BRIEF_FEATURE) }))),
    actor: opts.actor ?? 'admin',
  }).catch(() => null);
  result.jobId = jobId;
  const mark = async (i: number, state: 'running' | 'done' | 'failed') => {
    if (jobId) await markJobStep(jobId, `c${i + 1}`, state).catch(() => {});
  };

  try {
    for (const [i, company] of companies.entries()) {
      if (Date.now() > deadline) { result.partial = true; result.note = 'time budget used'; break; }
      const budget = await checkPackBriefBudget(weekEnd);
      if (!budget.ok) { result.partial = true; result.note = `weekly budget reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`; break; }

      await mark(i, 'running');
      const input = await loadPackInput(q, company.slug);
      if (!input) { await mark(i, 'failed'); result.failed += 1; continue; }
      const have = new Set(
        (await q<{ section_id: string }>(
          `select section_id from context_pack_briefs where company_slug = $1 and week_end = $2::date`,
          [company.slug, weekEnd]
        )).map((r) => r.section_id)
      );

      const outcomes = await Promise.allSettled(BRIEFABLE.map(async (sectionId) => {
        if (have.has(sectionId) && !opts.force) return 'skipped' as const;
        const src = briefSource(input, sectionId);
        if (!src) return 'skipped' as const;
        const out = await routedStructured<{ brief?: string }>({
          model,
          system: SYSTEM,
          user: `Company: ${input.company.name}\nSection: ${sectionId}\nAs of: ${input.asOf}\n\nThe section's lines, each followed by its source URLs in angle brackets:\n\n${src.text}`,
          toolName: 'submit_brief',
          toolDescription: 'Submit the orientation brief for this section.',
          schema: SCHEMA,
          maxTokens: 700,
          timeoutMs: 60_000,
          feature: BRIEF_FEATURE,
          metadata: { week_end: weekEnd, company: company.slug, section: sectionId },
        });
        // Figures are checked against the lines, never against their URLs:
        // an accession number in a link is not a figure the section states.
        const gated = gateBrief(out.brief ?? '', src.urls, src.text.replace(/<https?:\/\/[^>]+>/g, ' '));
        if (!gated) return 'refused' as const;
        await saveContextPackBrief({
          companySlug: company.slug, weekEnd, sectionId, body: gated.body, citeUrls: gated.citeUrls,
          dropped: gated.dropped, model: resolvedModel(model),
        });
        return 'written' as const;
      }));
      for (const o of outcomes) {
        if (o.status === 'rejected') result.failed += 1;
        else result[o.value] += 1;
      }
      await mark(i, outcomes.every((o) => o.status === 'rejected') ? 'failed' : 'done');
    }
    if (jobId) {
      if (result.partial) await parkUiJob(jobId, `Paused: ${result.note}. The next run writes what is missing.`).catch(() => {});
      else await finishUiJob(jobId, '/datasets/briefcase').catch(() => {});
    }
    return result;
  } catch (e) {
    if (jobId) await failUiJob(jobId, e instanceof Error ? e.message : 'brief run error').catch(() => {});
    throw e;
  }
}

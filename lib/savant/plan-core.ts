// Pure plan-selection and validation for Savant's weekly hypothesis
// (2026-09-26): which question is next in the lead-desk rotation, the
// deterministic plan a failed/budget-capped model call falls back to, and
// the gate that turns a raw model response into a trustworthy PlanPayload.
// PLAIN-NODE LOADABLE: only a type import (erased). House style: never an
// em dash in model-written text (deDash below, same rule as lib/voice.ts's,
// kept local so this module needs no import beyond its own type).

import type { PlanPayload } from './types';

const deDash = (s: string): string => s.replace(/\s*—\s*/g, ', ');

// The first rotation slug not among the last (rotation.length - 1) recent
// picks, so a rotation of N slugs guarantees no repeat until every other
// slug has led once. Empty rotation has no lead desk; 'capability' is the
// generic fallback question.
export function nextInRotation(rotation: string[], recentSlugs: string[]): string {
  if (rotation.length === 0) return 'capability';
  const windowSize = Math.max(0, rotation.length - 1);
  const recentWindow = new Set(recentSlugs.slice(Math.max(0, recentSlugs.length - windowSize)));
  for (const slug of rotation) {
    if (!recentWindow.has(slug)) return slug;
  }
  return rotation[0];
}

function recastAsQuestion(headline: string): string {
  const trimmed = headline.trim().replace(/[.?!]+$/, '');
  if (trimmed.length === 0) return 'Is this week’s biggest story what it looks like?';
  const lowered = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `Is it the case that ${lowered}?`;
}

export interface FallbackPlanInput {
  rotation: string[];
  recent: string[];
  topCluster: { headline: string; url: string | null } | null;
  weekEnd: string;
}

export function fallbackPlan(input: FallbackPlanInput): PlanPayload {
  const slug = nextInRotation(input.rotation, input.recent);
  const headline = input.topCluster?.headline ?? null;
  const topic = headline ?? `The week in ${slug}`;
  const why = headline
    ? `This week's biggest story touches the ${slug} question and the notebook has no fresh hypothesis there.`
    : `The ${slug} question is next in the lead-desk rotation and the notebook has no fresh hypothesis there.`;

  return {
    topic,
    question_slug: slug,
    why,
    hypothesis: {
      statement: deDash(recastAsQuestion(headline ?? topic)).slice(0, 240),
      what_would_settle_it: ['Two independent public records pointing the same way', 'A contrary filing or measurement'],
      watch: [slug],
    },
    sources_to_pull: [],
    fallback: true,
  };
}

function clipStringArray(v: unknown, maxItems = 6, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => deDash(s).trim().slice(0, maxLen))
    .slice(0, maxItems);
}

export interface ValidatePlanCtx {
  rotation: string[];
  fallback: PlanPayload;
}

// Coerces a raw model response into a PlanPayload, or returns ctx.fallback
// whenever the response is unusable: not an object, missing a topic or a
// hypothesis statement, or naming a question_slug outside the rotation.
export function validatePlan(raw: unknown, ctx: ValidatePlanCtx): PlanPayload {
  if (typeof raw !== 'object' || raw === null) return ctx.fallback;
  const r = raw as Record<string, unknown>;

  const topic = typeof r.topic === 'string' ? deDash(r.topic).trim() : '';
  const hypothesisRaw =
    typeof r.hypothesis === 'object' && r.hypothesis !== null ? (r.hypothesis as Record<string, unknown>) : {};
  const statement = typeof hypothesisRaw.statement === 'string' ? deDash(hypothesisRaw.statement).trim() : '';

  if (!topic || !statement) return ctx.fallback;

  const slugRaw = typeof r.question_slug === 'string' ? r.question_slug : '';
  const question_slug = ctx.rotation.includes(slugRaw) ? slugRaw : ctx.fallback.question_slug;

  const why = typeof r.why === 'string' && r.why.trim() ? deDash(r.why).trim().slice(0, 400) : ctx.fallback.why;

  const what_would_settle_it = clipStringArray(hypothesisRaw.what_would_settle_it);
  const watch = clipStringArray(hypothesisRaw.watch);
  const sources_to_pull = clipStringArray(r.sources_to_pull);

  return {
    topic: topic.slice(0, 200),
    question_slug,
    why,
    hypothesis: {
      statement: statement.slice(0, 240),
      what_would_settle_it: what_would_settle_it.length ? what_would_settle_it : ctx.fallback.hypothesis.what_would_settle_it,
      watch: watch.length ? watch : ctx.fallback.hypothesis.watch,
    },
    sources_to_pull,
    fallback: false,
  };
}

import { runStructured } from './dossier';

// Server-only. Two non-web structured calls for the /concepts authoring form,
// both recommend-only (the admin confirms each suggestion in the form; nothing
// here writes — same gate philosophy as the hypothesis recommenders):
//  - which existing concepts a new/edited concept depends on (prerequisite edges)
//  - which tracked hypotheses the concept is relevant to (hypothesis wiring)

interface ConceptForAI {
  name: string;
  short_definition: string;
  explanation: string;
}

function conceptBlock(c: ConceptForAI): string {
  return [
    `Name: ${c.name}`,
    `Definition: ${c.short_definition}`,
    c.explanation && `Explanation: ${c.explanation.slice(0, 2400)}`,
  ].filter(Boolean).join('\n');
}

// ---- prerequisite edges -----------------------------------------------------

const PREREQ_SYSTEM = `You map prerequisite dependencies between concepts for the Strategy Atlas's semantic scaffold — a layered knowledge graph where an edge means "a reader must understand X before Y".

Given ONE concept and the list of existing concepts, recommend which existing concepts are DIRECT prerequisites of it:
- A prerequisite is conceptually load-bearing: this concept's definition is hard to grasp without it. Thematic relatedness is NOT a dependency.
- Recommend DIRECT prerequisites only, never their ancestors (if attention requires embedding and embedding requires token, recommend only embedding).
- Usually 0–4. Recommending nothing is correct when the concept is foundational.
- reason = one concise sentence on why the reader needs it first.
Use only slugs from the provided list. You only RECOMMEND — the human confirms each edge. Never use an em dash in your reasons; use a comma or a colon instead.`;

export async function recommendConceptPrereqs(
  concept: ConceptForAI,
  existing: { slug: string; name: string; short_definition: string }[]
): Promise<{ slug: string; reason: string }[]> {
  if (!existing.length) return [];
  const slugs = existing.map((e) => e.slug);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug: { type: 'string', enum: slugs },
            reason: { type: 'string' },
          },
          required: ['slug', 'reason'],
        },
      },
    },
    required: ['recommendations'],
  };
  const list = existing
    .map((e) => `[${e.slug}] ${e.name} — ${e.short_definition}`)
    .join('\n');
  const out = await runStructured<{ recommendations: { slug: string; reason: string }[] }>({
    system: PREREQ_SYSTEM,
    user: `CONCEPT:\n${conceptBlock(concept)}\n\nEXISTING CONCEPTS:\n${list}`,
    toolName: 'submit_prerequisites',
    toolDescription: 'Return the recommended direct prerequisite concepts.',
    schema,
    maxTokens: 1000,
    effort: 'low',
    feature: 'concept_prereqs',
  });
  const valid = new Set(slugs);
  const seen = new Set<string>();
  return (out.recommendations ?? []).filter((r) => {
    if (!valid.has(r.slug) || seen.has(r.slug)) return false;
    seen.add(r.slug);
    return true;
  });
}

// ---- hypothesis wiring ------------------------------------------------------

const HYPOTHESIS_SYSTEM = `You wire concepts from the Strategy Atlas's semantic scaffold to its tracked hypotheses.

Given ONE concept and the hypothesis list, recommend the hypotheses this concept is genuinely RELEVANT to — hypotheses whose statement or falsification test invokes the concept, or cannot be evaluated without understanding it. Omit weak or merely thematic matches; recommending nothing is correct when no hypothesis leans on the concept. reason = one concise sentence on where the hypothesis leans on it. Use only codes from the provided list. You only RECOMMEND — the human confirms each link. Never use an em dash in your reasons; use a comma or a colon instead.`;

export async function recommendConceptHypotheses(
  concept: ConceptForAI,
  targets: { code: string; statement: string }[]
): Promise<{ code: string; statement: string; reason: string }[]> {
  if (!targets.length) return [];
  const codes = targets.map((t) => t.code);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', enum: codes },
            reason: { type: 'string' },
          },
          required: ['code', 'reason'],
        },
      },
    },
    required: ['recommendations'],
  };
  const list = targets.map((t) => `[${t.code}] ${t.statement}`).join('\n');
  const out = await runStructured<{ recommendations: { code: string; reason: string }[] }>({
    system: HYPOTHESIS_SYSTEM,
    user: `CONCEPT:\n${conceptBlock(concept)}\n\nHYPOTHESES:\n${list}`,
    toolName: 'submit_hypothesis_links',
    toolDescription: 'Return the recommended hypothesis links.',
    schema,
    maxTokens: 2000,
    effort: 'medium',
    feature: 'concept_hypotheses',
  });
  const byCode = new Map(targets.map((t) => [t.code, t]));
  const seen = new Set<string>();
  return (out.recommendations ?? []).flatMap((r) => {
    const t = byCode.get(r.code);
    if (!t || seen.has(r.code)) return [];
    seen.add(r.code);
    return [{ code: t.code, statement: t.statement, reason: r.reason }];
  });
}

// ---- gap diagnosis ------------------------------------------------------------

const GAP_SYSTEM = `You audit the semantic scaffold of the Strategy Atlas — a layered dependency graph of the terminology its tracked hypotheses lean on — and recommend concepts that are MISSING.

You receive the existing concepts (with their prerequisite wiring) and the tracked hypotheses. Recommend new concepts, in priority order, that are:
- vocabulary the hypotheses lean on but the scaffold lacks (a hypothesis or its test invokes a term no concept explains), or
- a missing intermediate that bridges existing concepts (a reader can't get from X to Z without it), or
- a foundational idea the scaffold silently assumes.

Rules:
- At most 5. Recommending fewer — or none — is correct when the scaffold is adequate. Never pad.
- No near-duplicates of existing concepts; if an existing concept could be EDITED to cover the gap, it is not a gap.
- argument: 1–3 sentences making the case — what it bridges, which hypotheses need it, why the scaffold is incomplete without it. This is the part the human judges.
- short_definition: one tooltip-ready sentence. explanation: 2–4 sentences of draft seed (the human expands it later). Be brief — this is a diagnosis, not the finished prose.
- status: 'contested' ONLY when the definition itself is disputed (who uses the word decides what it means); otherwise 'settled'.
- slug: lowercase-hyphenated. prerequisite_slugs: only slugs from the existing list, direct prerequisites only. hypothesis_codes: only codes from the provided list, only genuine reliance.
You only RECOMMEND — a human reviews each argument and decides what to create.
Never use an em dash in any text you write (arguments, definitions, explanations); use a comma, a colon, or separate sentences instead.`;

export async function diagnoseConceptGaps(
  existing: { slug: string; name: string; short_definition: string; status: string; prereq_slugs: string[] }[],
  targets: { code: string; statement: string }[]
): Promise<{
  slug: string; name: string; short_definition: string; explanation: string;
  status: string; prerequisite_slugs: string[]; hypothesis_codes: string[]; argument: string;
}[]> {
  const slugs = existing.map((e) => e.slug);
  const codes = targets.map((t) => t.code);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            short_definition: { type: 'string' },
            explanation: { type: 'string' },
            status: { type: 'string', enum: ['settled', 'contested'] },
            prerequisite_slugs: { type: 'array', items: { type: 'string', enum: slugs } },
            hypothesis_codes: { type: 'array', items: { type: 'string', enum: codes } },
            argument: { type: 'string' },
          },
          required: [
            'slug', 'name', 'short_definition', 'explanation',
            'status', 'prerequisite_slugs', 'hypothesis_codes', 'argument',
          ],
        },
      },
    },
    required: ['recommendations'],
  };
  const conceptList = existing
    .map((e) => `[${e.slug}] ${e.name} (${e.status}) — ${e.short_definition}${
      e.prereq_slugs.length ? ` | needs: ${e.prereq_slugs.join(', ')}` : ''
    }`)
    .join('\n');
  const hypothesisList = targets.map((t) => `[${t.code}] ${t.statement}`).join('\n');
  const out = await runStructured<{
    recommendations: {
      slug: string; name: string; short_definition: string; explanation: string;
      status: string; prerequisite_slugs: string[]; hypothesis_codes: string[]; argument: string;
    }[];
  }>({
    system: GAP_SYSTEM,
    user: `EXISTING CONCEPTS:\n${conceptList}\n\nTRACKED HYPOTHESES:\n${hypothesisList}`,
    toolName: 'submit_gap_diagnosis',
    toolDescription: 'Return the recommended missing concepts, in priority order.',
    schema,
    // Bounded for the 60s function cap (the report-generation lesson: long outputs at
    // ~20–30 tok/s blow the default 50s timeout, and an in-call SDK retry would double
    // it). One attempt, brief output; the admin re-runs on a fresh invocation if it fails.
    maxTokens: 2600,
    effort: 'medium',
    timeoutMs: 55_000,
    maxRetries: 0,
    feature: 'concept_gaps',
  });
  return out.recommendations ?? [];
}

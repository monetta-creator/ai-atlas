import { routedStructured } from '../model-route';
import { DEFAULT_UTILITY_MODEL } from '../pipeline/config';
import { DATASETS, getDataset } from '../datasets/registry';
import type { DatasetDef } from '../datasets/core';
import type { PortalIdentity } from './keys';
import { PORTAL_NL_FEATURE } from './budget';
import { buildNlCatalog, nlSchema, validateNlOutput, type NlOut, type NlValidated } from './nl-core';

// Natural-language-to-filter, the model-calling half (migration 0064). One
// routedStructured call per question: build the catalog over the datasets
// this identity may read, ask the utility model to pick a dataset and fill
// the filter grammar, then validate its answer against the live registry
// (nl-core.ts's validateNlOutput, which reuses lib/datasets/filter.ts so a
// dropped filter is explained the same way a hand-typed download URL's would
// be). PORTAL_NL_MODEL overrides the shared utility-model default so this one
// feature can be pinned separately if it needs a different tradeoff.

const MAX_QUESTION_LEN = 500;

// Every dataset is readable once the caller is active (admin included, since
// PortalIdentity.active is already true for the ADMIN identity); a caller
// with no active identity would never reach this module (the route requires
// one), so this is really just "public datasets only" as a defensive floor.
function readableFor(identity: PortalIdentity): (def: DatasetDef) => boolean {
  return (def) => identity.active || !def.keyGated;
}

function nlSystem(catalog: string): string {
  return `You translate a plain-language question into a filter over The AI Atlas's Data Portal. Below is the dataset catalog: one block per dataset, its slug and description, then its columns as "key type" with an enum column's closed value set shown in brackets.

${catalog}

Pick the single best-fit dataset for the question. Use only column keys, operators, and enum values shown for that dataset; never invent one. Prefer a pushdown field (lens, day, since, source, company) over a where filter when the question names one directly and the dataset supports it. If the question fits no dataset well, pick the closest one anyway and say so plainly in "explanation". Never use an em dash in any text you write; use a comma or a period instead.`;
}

export async function nlQuery(input: {
  question: string;
  dataset?: string;
  identity: PortalIdentity;
}): Promise<NlValidated & { href: string }> {
  const readable = readableFor(input.identity);
  const defs = input.dataset
    ? [getDataset(input.dataset)].filter((d): d is DatasetDef => Boolean(d))
    : DATASETS;
  const catalog = buildNlCatalog(defs, readable);
  const slugs = defs.filter(readable).map((d) => d.slug);

  const out = await routedStructured<NlOut>({
    model: process.env.PORTAL_NL_MODEL || DEFAULT_UTILITY_MODEL,
    system: nlSystem(catalog),
    user: input.question.trim().slice(0, MAX_QUESTION_LEN),
    toolName: 'submit_query',
    toolDescription: 'Report the chosen dataset and filter parameters for this question.',
    schema: nlSchema(slugs),
    maxTokens: 700,
    timeoutMs: 30_000,
    feature: PORTAL_NL_FEATURE,
    metadata: input.identity.keyId ? { portal_key_id: input.identity.keyId } : undefined,
  });

  const validated = validateNlOutput(out, defs, readable);

  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(validated.params)) {
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else {
      usp.append(key, value);
    }
  }
  const href = `/api/datasets/${validated.dataset}?${usp.toString()}`;

  return { ...validated, href };
}

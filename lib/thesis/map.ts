import { q } from '@/lib/db';
import { runStructured } from '@/lib/dossier';

// Thesis -> claim mapping (recommend-only; the admin confirms every code before it
// is written). One forced-tool, non-web runStructured call: the ENTIRE claim/bridge
// namespace ships in the (cached) system block, so a valid recommendation can only
// be a code the model has literally seen — and the post-filter drops anything else.
// "Maps to nothing" is a normal, useful outcome: the report then runs text-only and
// says so, and the thesis becomes a candidate for the add-claim authoring flow.

export interface ThesisMappingProposal {
  code: string;
  statement: string;   // resolved from the namespace, not from the model
  why: string;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      // No maxItems: strict tool mode supports only a schema subset, so the 5-cap
      // is enforced in the post-filter below (and asked for in the prompt).
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { code: { type: 'string' }, why: { type: 'string' } },
        required: ['code', 'why'],
      },
    },
    note: { type: 'string' },
  },
  required: ['proposals', 'note'],
};

const SYSTEM_HEAD =
  `You map a user's thesis about the AI economy onto the claims of an argument map. ` +
  `Below is the COMPLETE namespace of mappable records: falsifiable claims and ` +
  `bridge-claims, each with its stable code. Propose at most 5 codes whose truth the ` +
  `thesis directly bears on, or that directly bear on the thesis. For each, give one ` +
  `plain-language sentence saying why, grounded in the wording of both. Only use codes ` +
  `from the namespace, exactly as written; never invent one. Be conservative: a loose ` +
  `topical association is NOT a mapping. If nothing genuinely relates, return an empty ` +
  `list; that is a normal outcome, not a failure. In "note", give one or two sentences ` +
  `of orientation: what the mapping covers, or what the Atlas lacks for this thesis. ` +
  `Never use an em dash in your output; use a comma, a colon, or separate sentences instead.`;

export async function mapThesisToClaims(
  statement: string
): Promise<{ proposals: ThesisMappingProposal[]; note: string }> {
  const [claims, bridges] = await Promise.all([
    q<{ code: string; statement: string; test: string | null }>(
      `select code, statement, test from claims where code is not null and is_frame = false order by code`
    ),
    q<{ code: string; statement: string; test: string | null }>(
      `select code, statement, test from bridge_claims where code is not null order by code`
    ),
  ]);
  const namespace = [
    'CLAIMS',
    ...claims.map((c) => `[${c.code}] ${c.statement}${c.test ? ` (test: ${c.test})` : ''}`),
    '',
    'BRIDGE CLAIMS (links between domains)',
    ...bridges.map((b) => `[${b.code}] ${b.statement}${b.test ? ` (test: ${b.test})` : ''}`),
  ].join('\n');

  const out = await runStructured<{ proposals?: { code?: string; why?: string }[]; note?: string }>({
    system: `${SYSTEM_HEAD}\n\n${namespace}`,
    user: `THESIS: ${statement}`,
    toolName: 'submit_mapping',
    toolDescription: 'Return the claim codes this thesis bears on, with a one-line why each.',
    schema: SCHEMA,
    maxTokens: 900,
    effort: 'low',
    feature: 'thesis_map',
    timeoutMs: 55_000,
    maxRetries: 0,
  });

  const byCode = new Map<string, string>([
    ...claims.map((c): [string, string] => [c.code, c.statement]),
    ...bridges.map((b): [string, string] => [b.code, b.statement]),
  ]);
  const seen = new Set<string>();
  const proposals: ThesisMappingProposal[] = [];
  for (const p of Array.isArray(out.proposals) ? out.proposals : []) {
    if (proposals.length >= 5) break;
    const code = String(p?.code ?? '').trim();
    const resolved = byCode.get(code);
    if (!resolved || seen.has(code)) continue;   // invented or duplicate code: dropped
    seen.add(code);
    proposals.push({ code, statement: resolved, why: String(p?.why ?? '').trim() });
  }
  return { proposals, note: String(out.note ?? '').trim() };
}

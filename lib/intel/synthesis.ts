import { runStructured } from '../dossier';
import { chatJSONOpenRouter } from '../scan/llm';
import { mergeIntelCompanyDossier } from '../mutations/intel';
import { q } from '../db';
import { DEFAULT_UTILITY_MODEL } from '../pipeline/config';
import type { IntelCompany } from '../types';

// Dossier synthesis: one small-model read over a company's recent enriched
// items and extracted facts, merged monotonically into intel_companies.dossier
// (Scout's mergeDossier: latest non-empty summary wins, lists union, nothing
// clobbers). Runs weekly on Monday runs (the engine's synthesis phase) and on
// demand from the console. Feature 'intel_synthesis'; the utility model via
// OpenRouter when the key is set, else Haiku.

const SYNTH_MODEL = 'claude-haiku-4-5';
const MAX_ITEMS = 25;
const MAX_FACTS = 30;

interface RawSynthesis {
  summary: string;
  initiatives: string[];
  segments: string[];
}

export async function synthesizeCompanyDossier(
  company: Pick<IntelCompany, 'slug' | 'name'>,
  intelRunId?: string,
  utilityModel?: string | null
): Promise<{ updated: boolean; items: number; facts: number }> {
  const [items, facts] = await Promise.all([
    q<{ headline: string | null; summary: string | null; url: string; published_date: string | null }>(
      `select headline, summary, url, to_char(published_date, 'YYYY-MM-DD') as published_date
         from intel_items
        where $1 = any(company_slugs) and enrich_status = 'done'
        order by created_at desc limit ${MAX_ITEMS}`,
      [company.slug]
    ),
    q<{ dimension: string; fact: string; value_text: string | null; as_of: string | null }>(
      `select dimension, fact, value_text, to_char(as_of, 'YYYY-MM-DD') as as_of
         from intel_facts
        where company_slug = $1
        order by created_at desc limit ${MAX_FACTS}`,
      [company.slug]
    ),
  ]);
  if (!items.length && !facts.length) return { updated: false, items: 0, facts: 0 };

  const itemLines = items
    .map((i) => `- ${i.published_date ?? ''} ${i.headline ?? i.url}: ${(i.summary ?? '').slice(0, 300)}`)
    .join('\n');
  const factLines = facts
    .map((f) => `- [${f.dimension}] ${f.fact}${f.value_text ? ` (${f.value_text})` : ''}${f.as_of ? ` as of ${f.as_of}` : ''}`)
    .join('\n');

  const system = `You maintain the standing dossier on a company for a strategy desk. From the recent tracked items and extracted facts, write the current read: what the company is doing and where it is heading. Use only what the material supports; never invent. Never use an em dash in any text you write.`;
  const user = `COMPANY: ${company.name}

RECENT TRACKED ITEMS:
${itemLines || '(none)'}

EXTRACTED FACTS:
${factLines || '(none)'}`;

  const raw = process.env.OPENROUTER_API_KEY
    ? await chatJSONOpenRouter<RawSynthesis>({
        model: utilityModel || DEFAULT_UTILITY_MODEL,
        system: `${system}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly these keys:
  "summary": string, one paragraph (4 to 6 sentences): the company's current strategic posture and trajectory
  "initiatives": array of short strings, the notable current products, programs, or moves (up to 10)
  "segments": array of short strings, the key customer segments, markets, or partners in play (up to 8)`,
        user,
        maxTokens: 900,
        timeoutMs: 45_000,
        feature: 'intel_synthesis',
        metadata: { intel_run: intelRunId, company: company.slug },
      })
    : await runStructured<RawSynthesis>({
        system,
        user,
        toolName: 'submit_dossier',
        toolDescription: 'Return the synthesized dossier read for this company.',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', description: 'One paragraph, 4 to 6 sentences: current strategic posture and trajectory.' },
            initiatives: { type: 'array', items: { type: 'string' }, description: 'Notable current products, programs, or moves. Up to 10 short strings.' },
            segments: { type: 'array', items: { type: 'string' }, description: 'Key customer segments, markets, or partners in play. Up to 8 short strings.' },
          },
          required: ['summary', 'initiatives', 'segments'],
        },
        maxTokens: 900,
        effort: 'low',
        feature: 'intel_synthesis',
        metadata: { intel_run: intelRunId, company: company.slug },
        timeoutMs: 30_000,
        maxRetries: 0,
        model: SYNTH_MODEL,
      });

  const arr = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
  await mergeIntelCompanyDossier(company.slug, {
    summary: String(raw.summary ?? '').trim().slice(0, 2000),
    products: arr(raw.initiatives).slice(0, 10),
    customers: arr(raw.segments).slice(0, 8),
    sources: items.slice(0, 10).map((i) => i.url),
    updated_by: 'intel',
  });
  return { updated: true, items: items.length, facts: facts.length };
}

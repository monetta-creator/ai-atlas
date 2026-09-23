import { marked } from 'marked';
import { routedStructured } from '../model-route';
import { enforceCitations } from '../citations';
import { allowlistForCompany, allowlistForDeck } from './deck-pure';
import type { IntelDeckCompany, IntelDeckNarrative, IntelDeckPack } from './deck-types';

// The company intel deck's ONE model call: a one-sentence read per company
// ("what it adds up to") plus a short cross-company front, both in markdown
// with links only to that company's own items, facts and filings. Every
// sentence is gated with enforceCitations against the company's allowlist; a
// sentence whose links all fall to the gate is dropped (the slide then carries
// the facts alone). The front is gated against the whole deck's allowlist.
// Cheap model by default (intel_prefs.deck_model, GLM via OpenRouter).

const MAX_SENTENCE = 240;

const SYSTEM =
  'You write the one-line reads for a daily company intelligence deck read by analysts at a regulated ' +
  'financial-services company. For each company you receive yesterday\'s collected items (headline, url), ' +
  'the facts extracted from them, and any filings. Write ONE sentence per company, at most 240 characters, ' +
  'in plain declarative prose, saying what the day adds up to for that company. Every sentence MUST contain ' +
  'at least one markdown link [text](url) whose url is copied EXACTLY from that company\'s own items, facts or ' +
  'filings; never invent, shorten or alter a url, never link to another company\'s items. Skip a company ' +
  'rather than speculate when its material is thin. Then write a front of two or three sentences ranking the ' +
  'day\'s biggest moves across companies, with links under the same rule. No em dashes anywhere: use commas, ' +
  'colons or periods. No headers, no bullet markers, no quotation of whole headlines.';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { slug: { type: 'string' }, sentence_md: { type: 'string' } },
        required: ['slug', 'sentence_md'],
      },
    },
    front_md: { type: 'string' },
  },
  required: ['companies', 'front_md'],
};

function fmtCompany(c: IntelDeckCompany): string {
  const items = c.items.map((it) => `  - item: ${it.headline} (${it.url})${it.summary ? ` :: ${it.summary.slice(0, 220)}` : ''}`);
  const facts = c.facts.map((f) => `  - fact [${f.dimension}]: ${f.fact}${f.valueText ? ` (${f.valueText})` : ''}${f.url ? ` (${f.url})` : ''}`);
  const filings = c.filings.map((f) => `  - filing: ${f.headline} (${f.url})`);
  const metrics = c.metrics.map((m) => `  - metric: ${m.label} ${m.period} = ${m.value}${m.unit ? ` ${m.unit}` : ''}${m.deltaPct != null ? ` (${m.deltaPct.toFixed(1)}% vs ${m.prevPeriod})` : ''}`);
  return [`COMPANY ${c.slug} (${c.name}, ${c.tier})`, ...items, ...facts, ...filings, ...metrics].join('\n');
}

function inlineHtml(md: string): string {
  const clean = md.replace(/\s*—\s*/g, ', ').trim();
  return (marked.parseInline(clean, { async: false }) as string).trim();
}

type ReadsOut = { companies?: { slug?: string; sentence_md?: string }[]; front_md?: string };

// Companies per model call. One call over 24 companies produced ~2.4k output
// tokens and took 61s on GLM flash (the first attempt hit the 75s timeout),
// so the pack is split into chunks that run in parallel; the pack is sorted
// by score, so the first chunk holds the movers and is the only one asked
// for the front.
const CHUNK = 12;

async function readsFor(pack: IntelDeckPack, chunk: IntelDeckCompany[], withFront: boolean, model: string): Promise<ReadsOut> {
  const user = [
    `DAY: ${pack.day} (deck No. ${pack.issueNumber}). ${chunk.length} companies with something new${withFront ? '; the three highest-scoring first' : ''}.`,
    withFront ? '' : 'This batch is not the front: return front_md as an empty string.',
    ...chunk.map(fmtCompany),
  ].filter(Boolean).join('\n\n');
  return routedStructured<ReadsOut>({
    model,
    system: SYSTEM,
    user,
    toolName: 'submit_reads',
    toolDescription: 'Return one cited sentence per company and, for the first batch, the cross-company front.',
    schema: SCHEMA,
    maxTokens: 1600,
    timeoutMs: 90_000,
    feature: 'intel_deck_sentence',
    metadata: { day: pack.day, companies: chunk.length, front: withFront },
  });
}

export async function generateIntelDeckNarrative(pack: IntelDeckPack, model: string): Promise<IntelDeckNarrative> {
  const dropped: string[] = [];
  if (!pack.companies.length) return { sentences: [], frontHtml: null, model, dropped };
  const top = pack.companies.slice(0, 24);
  const chunks: IntelDeckCompany[][] = [];
  for (let i = 0; i < top.length; i += CHUNK) chunks.push(top.slice(i, i + CHUNK));
  // A chunk that fails (timeout, malformed JSON after the client's retry)
  // loses only its own sentences; the rest of the deck keeps its reads.
  const settled = await Promise.allSettled(chunks.map((chunk, i) => readsFor(pack, chunk, i === 0, model)));
  const outs: (ReadsOut | null)[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    dropped.push(`batch ${i + 1} of ${chunks.length} failed: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 160)}`);
    return null;
  });
  if (outs.every((o) => o === null)) throw new Error(dropped[dropped.length - 1] ?? 'every batch failed');
  const out: ReadsOut = {
    companies: outs.flatMap((o) => o?.companies ?? []),
    front_md: outs[0]?.front_md ?? '',
  };

  const bySlug = new Map(top.map((c) => [c.slug, c]));
  const seen = new Set<string>();
  const sentences: { slug: string; html: string }[] = [];
  for (const row of out.companies ?? []) {
    const slug = String(row.slug ?? '');
    const c = bySlug.get(slug);
    if (!c || seen.has(slug)) { if (slug) dropped.push(`sentence for unknown or duplicate company ${slug}`); continue; }
    seen.add(slug);
    const md = String(row.sentence_md ?? '').trim();
    if (!md) continue;
    const gated = enforceCitations(`<p>${inlineHtml(md.slice(0, MAX_SENTENCE * 2))}</p>`, allowlistForCompany(c));
    if (!gated.html || gated.cited.length === 0) { dropped.push(`sentence for ${slug}: no surviving link`); continue; }
    sentences.push({ slug, html: gated.html });
    for (const d of gated.dropped) dropped.push(`sentence for ${slug}: dropped link ${d}`);
  }

  let frontHtml: string | null = null;
  const frontMd = String(out.front_md ?? '').trim();
  if (frontMd) {
    const gated = enforceCitations(`<p>${inlineHtml(frontMd.slice(0, 900))}</p>`, allowlistForDeck(pack));
    if (gated.html && gated.cited.length > 0) frontHtml = gated.html;
    else dropped.push('front: no surviving link');
    for (const d of gated.dropped) dropped.push(`front: dropped link ${d}`);
  }

  return { sentences, frontHtml, model, dropped };
}

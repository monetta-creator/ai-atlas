import { marked } from 'marked';
import { runStructured } from '@/lib/dossier';
import { SIGNAL_CONTEXT_LABEL } from '@/lib/format';
import type { HypothesisPack } from '@/lib/types';
import { allowlistFor, enforceCitations } from './citations';

// Hypothesis-report narrative generation. Two decomposed forced-tool runStructured
// calls, orchestrated from the client: (1) the two body sections, (2) the bottom
// line + title, written over the already-drafted sections. The model narrates
// ONLY over the frozen pack; every statistic is computed in code and handed in
// as authoritative; and every returned section passes the deterministic citation
// gate before it leaves the server.

const clip = (s: string | null | undefined, n: number): string => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)} ...` : t;
};

// Belt-and-braces on the writing rule: the prompts forbid em dashes, and any
// that slip through are normalized before the markdown is rendered.
const deDash = (md: string) => md.replace(/\s*—\s*/g, ', ');

const toHtml = (md: string): string => {
  const clean = deDash(md).trim();
  if (!clean) return '';
  const html = marked.parse(clean, { async: false }) as string;
  // The section titles are rendered by the app; drop a leading heading the model
  // may emit anyway (same guard as report-generate).
  return html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
};

const VOICE =
  `You are writing a grounded hypothesis report for the Strategy Atlas, a tool for ` +
  `staying oriented on the strategic questions an operating team is testing. You receive ` +
  `ONE hypothesis (statement + falsifying test) and a frozen evidence pack: the Atlas ` +
  `signals (tracked developments, internal and external) that matched it, direction data, ` +
  `quoted excerpts, and computed statistics. Write ONLY from this pack. The goal is ` +
  `orientation, not proof: state plainly what the evidence shows, what it does not show, ` +
  `and where coverage is thin. Never invent a development, number, quote, URL, or code; ` +
  `the STATISTICS block is authoritative, use its exact figures. Cite every specific ` +
  `development inline as a markdown link on its tag using the EXACT href provided, e.g. ` +
  `[S3](/signals/1234-uuid). Do not link to anything outside the pack. Write like a ` +
  `senior analyst briefing a working team: confident where the evidence is strong, ` +
  `explicit where it is weak, never falsely confident. Tight paragraphs, bullets where ` +
  `they help. Output GitHub-flavored MARKDOWN. Do not begin with a heading. Never use an ` +
  `em dash in your output; use a comma, a colon, or separate sentences instead.`;

const PROMPT_SIGNAL_CAP = 80;   // prompt-size bound; the stats always cover ALL matches

// Serialize the pack for the model. Deterministic: pack order is preserved, caps
// are fixed, and any truncation is stated explicitly (no silent caps).
function fmtPack(pack: HypothesisPack): string {
  const s = pack.stats;
  const lines: string[] = [];
  lines.push(`HYPOTHESIS ${pack.code}: ${pack.statement}`);
  lines.push(`FALSIFYING TEST: ${clip(pack.test, 300)}`);
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  lines.push(`- ${s.matched} of ${s.scanned} published signals matched (touch-matched ${s.byMatch.touch + s.byMatch.both}, text-only ${s.byMatch.text}).`);
  lines.push(`- Signal directions toward the hypothesis: ${s.directions.supports} supporting, ${s.directions.contradicts} contradicting, ${s.directions.neutral} neutral, ${s.directions.untyped} without direction data.`);
  lines.push(`- Significance mix: ${s.significance.high} high, ${s.significance.medium} medium, ${s.significance.low} low.`);
  if (s.firstPublished && s.lastPublished) lines.push(`- Matched signals span ${s.firstPublished} to ${s.lastPublished}.`);
  if (s.contexts.length) lines.push(`- Context distribution: ${s.contexts.map((c) => `${SIGNAL_CONTEXT_LABEL[c.context]} ${c.n}`).join(', ')}.`);
  if (s.oneSided) lines.push('- WARNING: the evidence is one-sided (no contradicting signal in the corpus).');
  if (s.thin) lines.push('- WARNING: coverage is thin (fewer than 5 matched signals).');
  lines.push(`- Coverage statement: ${s.corpusNote}`);
  if (pack.delta) {
    const d = pack.delta;
    lines.push('');
    lines.push(
      `SINCE THE LAST SAVED RUN (${d.prev_generated_at.slice(0, 10)}): ${d.new_signal_tags.length} new ` +
      `signal${d.new_signal_tags.length === 1 ? '' : 's'} (${d.new_signal_tags.join(', ') || 'none'}); ` +
      `${d.removed_count} no longer match. New-signal directions: ${d.new_directions.supports} supporting, ` +
      `${d.new_directions.contradicts} contradicting, ${d.new_directions.neutral} neutral, ` +
      `${d.new_directions.untyped} without direction data.`
    );
  }
  lines.push('');
  const shown = pack.signals.slice(0, PROMPT_SIGNAL_CAP);
  lines.push(`MATCHED SIGNALS (${pack.signals.length}${shown.length < pack.signals.length ? `; the first ${shown.length} shown individually, the rest are still counted in the statistics above` : ''}):`);
  for (const sig of shown) {
    lines.push(
      `- [${sig.tag}](/signals/${sig.id}) "${sig.title}" · ${sig.significance} · ${sig.context} · ${sig.published_at ?? 'undated'}` +
      `${sig.source_domain ? ` · ${sig.source_domain}` : ''}${sig.direction ? ` · bears: ${sig.direction}` : ' · no direction data'}` +
      `\n    ${clip(sig.summary, 300)}`
    );
  }
  if (pack.evidence.length) {
    lines.push('');
    lines.push('QUOTED EXCERPTS (quote only from these, verbatim or clipped):');
    for (const e of pack.evidence.slice(0, 12)) {
      lines.push(`- (${e.direction})${e.signal_tag ? ` from ${e.signal_tag}` : ''}: "${clip(e.excerpt, 240)}"`);
    }
  }
  return lines.join('\n');
}

const SECTIONS_SYSTEM =
  `${VOICE} Produce the two body sections of the report. ` +
  `"reading", titled "What the signals show" by the app: the through-line of the matched ` +
  `evidence as it bears on the hypothesis, weaving in the strongest supporting and ` +
  `contradicting signals with citations, roughly 250 to 380 words. ` +
  `"counterweight", titled "The other read and what is missing" by the app: the strongest ` +
  `contrary interpretation of the same evidence, then what the corpus does NOT cover, ` +
  `leaning on the one-sidedness and thinness warnings and the untyped counts when present, ` +
  `roughly 150 to 260 words. Both sections are markdown bodies only, no headings.`;

const SECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { reading: { type: 'string' }, counterweight: { type: 'string' } },
  required: ['reading', 'counterweight'],
};

export interface HypothesisSectionsOut {
  readingMd: string;        // raw markdown (input for the bottom-line pass)
  counterweightMd: string;
  readingHtml: string;      // citation-gated HTML (what the client renders and saves)
  counterweightHtml: string;
  dropped: string[];        // hrefs the gate stripped (surfaced to the admin)
}

export async function generateHypothesisSections(pack: HypothesisPack): Promise<HypothesisSectionsOut> {
  const out = await runStructured<{ reading?: string; counterweight?: string }>({
    system: SECTIONS_SYSTEM,
    user: fmtPack(pack),
    toolName: 'submit_hypothesis_sections',
    toolDescription: 'Return the two markdown body sections of the hypothesis report.',
    schema: SECTIONS_SCHEMA,
    maxTokens: 1700,
    effort: 'medium',
    feature: 'hypothesis_sections',
    metadata: { hypothesisId: pack.hypothesis_id },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const readingMd = String(out.reading ?? '');
  const counterweightMd = String(out.counterweight ?? '');
  const allow = allowlistFor(pack);
  const reading = enforceCitations(toHtml(readingMd), allow);
  const counterweight = enforceCitations(toHtml(counterweightMd), allow);
  return {
    readingMd,
    counterweightMd,
    readingHtml: reading.html ?? '',
    counterweightHtml: counterweight.html ?? '',
    dropped: [...new Set([...reading.dropped, ...counterweight.dropped])].sort(),
  };
}

const BOTTOM_SYSTEM =
  `${VOICE} You receive the pack plus the two already-written body sections. Produce ` +
  `"bottom_line": a single standalone paragraph of roughly 80 to 140 words that begins ` +
  `with "**Bottom line:**" (bold) and gives the working-team takeaway: where the evidence ` +
  `leaves this hypothesis, how much weight it can bear, and what to watch next. Synthesize ` +
  `across the sections, do not repeat them. Also produce "report_title": a short, vivid ` +
  `editorial headline for the report, at most 8 words, plain text, no quotes, no date, ` +
  `and do not include the words "Strategy Atlas".`;

const BOTTOM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bottom_line: { type: 'string' }, report_title: { type: 'string' } },
  required: ['bottom_line', 'report_title'],
};

export async function generateHypothesisBottomLine(
  pack: HypothesisPack,
  sections: { readingMd: string; counterweightMd: string }
): Promise<{ bottomLineHtml: string; title: string; dropped: string[] }> {
  const user = [
    fmtPack(pack),
    '',
    'SECTION: What the signals show (already written):',
    sections.readingMd,
    '',
    'SECTION: The other read and what is missing (already written):',
    sections.counterweightMd,
  ].join('\n');
  const out = await runStructured<{ bottom_line?: string; report_title?: string }>({
    system: BOTTOM_SYSTEM,
    user,
    toolName: 'submit_hypothesis_bottom_line',
    toolDescription: 'Return the bottom-line paragraph and an editorial report title.',
    schema: BOTTOM_SCHEMA,
    maxTokens: 700,
    effort: 'medium',
    feature: 'hypothesis_bottom_line',
    metadata: { hypothesisId: pack.hypothesis_id },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const gated = enforceCitations(toHtml(String(out.bottom_line ?? '')), allowlistFor(pack));
  return {
    bottomLineHtml: gated.html ?? '',
    title: deDash(String(out.report_title ?? '')).trim().slice(0, 120),
    dropped: gated.dropped,
  };
}

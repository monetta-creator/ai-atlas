import { marked } from 'marked';
import { runStructured } from '@/lib/dossier';
import { SIGNAL_LENS_LABEL, SHEET_SECTION_TITLES } from '@/lib/format';
import type { ClaimSheetPack, LensSheetPack, AtlasSheetPack, SheetPack, SheetNarrative } from '@/lib/types';
import { enforceCitations, byTagNumber, type CitationAllowlist } from '@/lib/citations';

// Tear-sheet narrative generation (claim/bridge, lens, atlas kinds). Same machine
// as lib/thesis/generate.ts: two decomposed forced-tool runStructured calls, the
// model narrates ONLY over the frozen pack, every statistic is computed in code
// and handed in as authoritative, and every returned section passes the
// deterministic citation gate before it leaves the server.

const clip = (s: string | null | undefined, n: number): string => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n)} ...` : t;
};

// Belt-and-braces on the writing rule: the prompts forbid em dashes, and any that
// slip through are normalized before the markdown is rendered.
const deDash = (md: string) => md.replace(/\s*—\s*/g, ', ');

const toHtml = (md: string): string => {
  const clean = deDash(md).trim();
  if (!clean) return '';
  const html = marked.parse(clean, { async: false }) as string;
  return html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
};

// Section titles live in lib/format.ts (SHEET_SECTION_TITLES / SHEET_KIND_LABEL,
// client-safe); the prompts reference them so the app-rendered headings and the
// briefs never drift.

const VOICE =
  `You are writing a grounded report for The AI Atlas, a tool for staying oriented in the ` +
  `AI-economy debate, for an executive audience leading AI strategy. You receive a frozen ` +
  `evidence pack: Atlas records with exact hrefs, direction data, quoted excerpts, and ` +
  `computed statistics. Write ONLY from this pack. The goal is orientation, not proof: ` +
  `state plainly what the evidence shows, what it does not show, and where coverage is ` +
  `thin. No fluff: every sentence must carry a fact from the pack or a judgment grounded ` +
  `in one. No throat-clearing, no generic AI-industry prose, no restating the obvious. If ` +
  `the pack is thin, say so plainly. Never invent a development, number, quote, URL, or ` +
  `code; the STATISTICS block is authoritative, use its exact figures. Cite every ` +
  `specific development inline as a markdown link on its tag using the EXACT href ` +
  `provided, e.g. [S3](/signals/1234-uuid). When you reference a claim or bridge-claim, ` +
  `paraphrase its statement and link the phrase to its EXACT href, e.g. [entry-level ` +
  `hiring is contracting (4.2)](/claim/4.2); never a bare code alone. Do not link to ` +
  `anything outside the pack. Write like a senior analyst briefing an executive: ` +
  `confident where the evidence is strong, explicit where it is weak, never falsely ` +
  `confident. Tight paragraphs, bullets where they help. Output GitHub-flavored ` +
  `MARKDOWN. Do not begin with a heading. Never use an em dash in your output; use a ` +
  `comma, a colon, or separate sentences instead.`;

// ---------------------------------------------------------------- allowlists

export function allowlistForSheet(pack: SheetPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const s of pack.signals) {
    const href = `/signals/${s.id}`;
    hrefs.add(href);
    tagByHref.set(href, s.tag);
    if (s.source_url) hrefs.add(s.source_url);
  }
  if (pack.kind === 'lens') {
    for (const c of pack.codes) hrefs.add(c.href);
    for (const e of pack.evidence) if (e.source_url) hrefs.add(e.source_url);
  } else if (pack.kind === 'atlas') {
    for (const qn of pack.questions) hrefs.add(`/q/${qn.slug}`);
    for (const t of pack.oneSidedTargets) hrefs.add(t.href);
    for (const t of pack.theses) if (t.report_id) hrefs.add(`/thesis-report/${t.report_id}`);
  } else {
    hrefs.add(pack.node.href);
    for (const st of pack.stances) hrefs.add(`/q/${st.q_slug}`);
    for (const b of pack.bridges) hrefs.add(b.href);
    for (const f of pack.frames) hrefs.add(f.href);
    for (const c of pack.concepts) hrefs.add(c.href);
    for (const t of pack.theses) if (t.latest_report_id) hrefs.add(`/thesis-report/${t.latest_report_id}`);
    for (const e of pack.evidence) if (e.source_url) hrefs.add(e.source_url);
  }
  return { hrefs, tagByHref };
}

// ---------------------------------------------------------------- serializers

const PROMPT_SIGNAL_CAP = 60;
const PROMPT_EVIDENCE_CAP = 24;

function fmtSignals(pack: SheetPack, lines: string[], withDirection: boolean): void {
  const shown = pack.signals.slice(0, PROMPT_SIGNAL_CAP);
  lines.push(
    `SIGNALS (${pack.signals.length}${shown.length < pack.signals.length ? `; the first ${shown.length} shown individually, the rest are still counted in the statistics above` : ''}):`
  );
  for (const s of shown) {
    lines.push(
      `- [${s.tag}](/signals/${s.id}) "${s.title}" · ${s.significance} · ${s.published_at ?? 'undated'}` +
      `${s.source_domain ? ` · ${s.source_domain}` : ''}` +
      `${withDirection ? ` · direction toward the subject: ${s.direction ?? 'no direction data'}` : ''}` +
      `\n    ${clip(s.summary, 280)}`
    );
  }
}

function fmtEvidence(evidence: ClaimSheetPack['evidence'], lines: string[]): void {
  const withExcerpt = evidence.filter((e) => e.excerpt);
  if (!withExcerpt.length) return;
  lines.push('');
  lines.push('EVIDENCE LEDGER (quote only from these, verbatim or clipped; a source href is citable):');
  for (const e of withExcerpt.slice(0, PROMPT_EVIDENCE_CAP)) {
    const src = e.source_title
      ? `, source "${clip(e.source_title, 80)}"${e.source_outlet ? ` (${e.source_outlet})` : ''}${e.source_url ? `, href ${e.source_url}` : ''}`
      : '';
    lines.push(
      `- toward ${e.code} (${e.direction}, ${e.weight} weight)${e.signal_tag ? `, from ${e.signal_tag}` : ''}${src}: "${clip(e.excerpt, 220)}"`
    );
  }
}

function fmtClaimPack(pack: ClaimSheetPack): string {
  const s = pack.stats;
  const n = pack.node;
  const lines: string[] = [];
  const kindWord = pack.kind === 'bridge' ? 'bridge-claim' : 'claim';
  lines.push(`SUBJECT ${kindWord.toUpperCase()} ${n.code} (href ${n.href}): ${n.statement}`);
  if (n.test) lines.push(`Falsifying test: ${n.test}`);
  const meta: string[] = [];
  if (n.domain) meta.push(`domain ${n.domain}`);
  if (n.domain_from && n.domain_to) meta.push(`bridges ${n.domain_from} to ${n.domain_to}`);
  if (n.resolvability) meta.push(`${n.resolvability} to resolve`);
  if (n.reflexive) meta.push('reflexive (belief about it changes it)');
  if (meta.length) lines.push(`Profile: ${meta.join(' · ')}.`);
  lines.push('');
  if (pack.stances.length) {
    lines.push('BEARS ON STANCES (cite via the question href):');
    for (const st of pack.stances) {
      lines.push(`- ${st.relation} "${st.stance_title}" in the question "${st.q_title}" (href /q/${st.q_slug})`);
    }
  }
  if (pack.bridges.length) {
    lines.push(pack.kind === 'bridge' ? 'FED BY CLAIMS (cite with exact href):' : 'BRIDGE-CLAIMS IT FEEDS (cite with exact href):');
    for (const b of pack.bridges) lines.push(`- ${b.relation} ${b.code} (href ${b.href}): ${clip(b.statement, 200)}`);
  }
  if (pack.frames.length) {
    lines.push('ORGANIZED BY FRAMES (cite with exact href):');
    for (const f of pack.frames) lines.push(`- ${f.code} (href ${f.href}): ${clip(f.statement, 200)}`);
  }
  if (pack.concepts.length) {
    lines.push('LINKED CONCEPTS (cite with exact href):');
    for (const c of pack.concepts) lines.push(`- ${c.name} (${c.status}, href ${c.href})`);
  }
  if (pack.theses.length) {
    lines.push('STANDING THESES TRACKING THIS NODE:');
    for (const t of pack.theses) {
      lines.push(
        `- "${clip(t.statement, 200)}"${t.latest_report_id ? ` (latest report href /thesis-report/${t.latest_report_id})` : ' (no saved report yet; do not link)'}`
      );
    }
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  lines.push(`- Evidence: ${s.evidence.total} items, ${s.evidence.supports} supporting, ${s.evidence.contradicts} contradicting, ${s.evidence.neutral} neutral (weights: ${s.evidence.byWeight.high} high, ${s.evidence.byWeight.medium} medium, ${s.evidence.byWeight.low} low).`);
  lines.push(`- Signals touching it: ${s.signals.total} (${s.signals.byDirection.supports} supporting, ${s.signals.byDirection.contradicts} contradicting, ${s.signals.byDirection.neutral} neutral, ${s.signals.byDirection.untyped} without direction data); significance ${s.signals.significance.high} high, ${s.signals.significance.medium} medium, ${s.signals.significance.low} low.`);
  if (s.signals.firstPublished && s.signals.lastPublished) lines.push(`- Signals span ${s.signals.firstPublished} to ${s.signals.lastPublished}.`);
  if (s.signals.lenses.length) lines.push(`- Lens distribution: ${s.signals.lenses.map((l) => `${SIGNAL_LENS_LABEL[l.lens]} ${l.n}`).join(', ')}.`);
  if (s.evidence.oneSided) lines.push('- WARNING: the evidence is one-sided.');
  if (s.thin) lines.push('- WARNING: coverage is thin (fewer than 5 evidence items).');
  lines.push(`- Coverage statement: ${s.corpusNote}`);
  lines.push('');
  fmtSignals(pack, lines, true);
  fmtEvidence(pack.evidence, lines);
  return lines.join('\n');
}

function fmtLensPack(pack: LensSheetPack): string {
  const s = pack.stats;
  const lines: string[] = [];
  lines.push(`SUBJECT LENS: ${pack.label} (the Signal Board's ${pack.subject} audience lens).`);
  lines.push('');
  if (pack.codes.length) {
    lines.push('CLAIMS THE LENS TOUCHES (cite with exact href; ordered by signal count):');
    for (const c of pack.codes.slice(0, 30)) {
      lines.push(
        `- ${c.code} (${c.type === 'bridge_claim' ? 'bridge-claim' : 'claim'}, href ${c.href}, ` +
        `${c.signal_count} signal${c.signal_count === 1 ? '' : 's'}, evidence ${c.directions.supports}s/${c.directions.contradicts}c/${c.directions.neutral}n): ${clip(c.statement, 200)}` +
        (c.test ? `\n    Falsifying test: ${clip(c.test, 180)}` : '')
      );
    }
  } else {
    lines.push('CLAIMS THE LENS TOUCHES: none in scope.');
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  lines.push(`- ${s.signals.total} signals in scope; significance ${s.signals.significance.high} high, ${s.signals.significance.medium} medium, ${s.signals.significance.low} low.`);
  lines.push(`- ${s.codes} touched claims; direction data is one-sided for: ${s.oneSidedCodes.length ? s.oneSidedCodes.join(', ') : 'none'}.`);
  if (s.signals.firstPublished && s.signals.lastPublished) lines.push(`- Signals span ${s.signals.firstPublished} to ${s.signals.lastPublished}.`);
  if (s.thin) lines.push('- WARNING: coverage is thin (fewer than 5 signals in scope).');
  lines.push(`- Coverage statement: ${s.corpusNote}`);
  lines.push('');
  fmtSignals(pack, lines, false);
  fmtEvidence(pack.evidence, lines);
  return lines.join('\n');
}

function fmtAtlasPack(pack: AtlasSheetPack): string {
  const h = pack.health;
  const lines: string[] = [];
  lines.push('SUBJECT: the whole Atlas, an executive briefing on the state of the AI-economy debate.');
  lines.push('');
  lines.push('THE MAP (cite a question with its exact href):');
  for (const qn of pack.questions) {
    lines.push(`- Question "${qn.title}" (href /q/${qn.slug}):`);
    for (const st of qn.stances) {
      lines.push(
        `    - Stance "${st.title}": ${st.claims_supporting} claims supporting, ${st.claims_contradicting} contradicting; ` +
        `evidence rollup ${st.evidence.supports}s/${st.evidence.contradicts}c/${st.evidence.neutral}n`
      );
    }
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  lines.push(`- ${h.claims} claims and ${h.bridges} bridge-claims tracked; ${h.evidence} evidence items; ${h.signalsPublished} published signals.`);
  lines.push(`- ${h.uncovered} tracked nodes carry no evidence yet; the evidence on ${h.oneSided} is one-sided.`);
  lines.push(`- Coverage statement: ${pack.stats.corpusNote}`);
  if (pack.oneSidedTargets.length) {
    lines.push('');
    lines.push('MOST ONE-SIDED NODES (cite with exact href):');
    for (const t of pack.oneSidedTargets) lines.push(`- ${t.code} (href ${t.href}): ${clip(t.statement, 180)}`);
  }
  if (pack.theses.length) {
    lines.push('');
    lines.push('STANDING THESES (latest run each; cite the report href when present):');
    for (const t of pack.theses) {
      lines.push(
        `- "${clip(t.statement, 180)}": ${t.matched} signals matched, ${t.supports} supporting, ${t.contradicts} contradicting, ${t.mixed} mixed` +
        `${t.report_id ? ` (href /thesis-report/${t.report_id})` : ''}`
      );
    }
  }
  lines.push('');
  fmtSignals(pack, lines, false);
  return lines.join('\n');
}

export function fmtSheetPack(pack: SheetPack): string {
  if (pack.kind === 'lens') return fmtLensPack(pack);
  if (pack.kind === 'atlas') return fmtAtlasPack(pack);
  return fmtClaimPack(pack);
}

// ---------------------------------------------------------------- generation

const SECTION_BRIEFS: Record<SheetPack['kind'], string> = {
  claim:
    `"reading", titled "${SHEET_SECTION_TITLES.claim.reading}" by the app: where the evidence on this ` +
    `claim stands, weaving the strongest supporting and contradicting items with citations, 200 to 320 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.claim.connections}" by the app: what this claim's position ` +
    `implies for the stances, bridges, theses, and concepts wired to it, synthesized, not listed, 120 to 220 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.claim.watch}" by the app: the falsifying test in practical terms, ` +
    `what evidence is missing, and what a decisive development would look like, 100 to 180 words.`,
  bridge:
    `"reading", titled "${SHEET_SECTION_TITLES.bridge.reading}" by the app: where the evidence on this ` +
    `bridge-claim stands, 200 to 320 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.bridge.connections}" by the app: how the feeding claims and ` +
    `the two domains it bridges bear on it, synthesized, 120 to 220 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.bridge.watch}" by the app: the falsifying test in practical terms ` +
    `and what evidence is missing, 100 to 180 words.`,
  lens:
    `"reading", titled "${SHEET_SECTION_TITLES.lens.reading}" by the app: the through-line of this lens's ` +
    `signals in scope, the developments that matter and why, 220 to 340 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.lens.connections}" by the app: which map claims this lens's ` +
    `evidence is moving and how the claims relate to each other, 140 to 240 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.lens.watch}" by the app: where coverage is thin or one-sided and ` +
    `what to watch next through this lens, 100 to 180 words.`,
  atlas:
    `"reading", titled "${SHEET_SECTION_TITLES.atlas.reading}" by the app: where the debate stands across the ` +
    `open questions, which stances the evidence currently favors and where it is genuinely contested, 240 to 380 words. ` +
    `"connections", titled "${SHEET_SECTION_TITLES.atlas.connections}" by the app: what the recent signals and ` +
    `thesis runs changed, 140 to 240 words. ` +
    `"watch", titled "${SHEET_SECTION_TITLES.atlas.watch}" by the app: coverage gaps, one-sided nodes, and the ` +
    `developments that would most move the map, 100 to 180 words.`,
};

const SECTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reading: { type: 'string' },
    connections: { type: 'string' },
    watch: { type: 'string' },
  },
  required: ['reading', 'connections', 'watch'],
};

export interface SheetSectionsOut {
  readingMd: string;
  connectionsMd: string;
  watchMd: string;
  readingHtml: string;
  connectionsHtml: string;
  watchHtml: string;
  dropped: string[];
}

export async function generateSheetSections(pack: SheetPack): Promise<SheetSectionsOut> {
  const out = await runStructured<{ reading?: string; connections?: string; watch?: string }>({
    system: `${VOICE} Produce the three body sections of the report. ${SECTION_BRIEFS[pack.kind]} All three are markdown bodies only, no headings.`,
    user: fmtSheetPack(pack),
    toolName: 'submit_sheet_sections',
    toolDescription: 'Return the three markdown body sections of the report.',
    schema: SECTIONS_SCHEMA,
    maxTokens: 2000,
    effort: 'medium',
    feature: 'tearsheet_sections',
    metadata: { kind: pack.kind, subject: pack.subject },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const readingMd = String(out.reading ?? '');
  const connectionsMd = String(out.connections ?? '');
  const watchMd = String(out.watch ?? '');
  const allow = allowlistForSheet(pack);
  const reading = enforceCitations(toHtml(readingMd), allow);
  const connections = enforceCitations(toHtml(connectionsMd), allow);
  const watch = enforceCitations(toHtml(watchMd), allow);
  return {
    readingMd,
    connectionsMd,
    watchMd,
    readingHtml: reading.html ?? '',
    connectionsHtml: connections.html ?? '',
    watchHtml: watch.html ?? '',
    dropped: [...new Set([...reading.dropped, ...connections.dropped, ...watch.dropped])].sort(),
  };
}

const CLOSE_SYSTEM =
  `${VOICE} You receive the pack plus the three already-written body sections. Produce ` +
  `"bottom_line": a single standalone paragraph of roughly 60 to 120 words that begins ` +
  `with "**Bottom line:**" (bold) and gives the executive takeaway: what this report ` +
  `establishes, how much weight it can bear, and the single most important thing to ` +
  `watch. Synthesize across the sections, do not repeat them. Also produce ` +
  `"report_title": a short, vivid editorial headline for the report, at most 8 words, ` +
  `plain text, no quotes, no date, and do not include the words "AI Atlas".`;

const CLOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bottom_line: { type: 'string' }, report_title: { type: 'string' } },
  required: ['bottom_line', 'report_title'],
};

export async function generateSheetClose(
  pack: SheetPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string }
): Promise<{ bottomLineHtml: string; title: string; dropped: string[] }> {
  const titles = SHEET_SECTION_TITLES[pack.kind];
  const user = [
    fmtSheetPack(pack),
    '',
    `SECTION: ${titles.reading} (already written):`,
    sections.readingMd,
    '',
    `SECTION: ${titles.connections} (already written):`,
    sections.connectionsMd,
    '',
    `SECTION: ${titles.watch} (already written):`,
    sections.watchMd,
  ].join('\n');
  const out = await runStructured<{ bottom_line?: string; report_title?: string }>({
    system: CLOSE_SYSTEM,
    user,
    toolName: 'submit_sheet_close',
    toolDescription: 'Return the bottom-line paragraph and an editorial report title.',
    schema: CLOSE_SCHEMA,
    maxTokens: 700,
    effort: 'medium',
    feature: 'tearsheet_close',
    metadata: { kind: pack.kind, subject: pack.subject },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const gated = enforceCitations(toHtml(String(out.bottom_line ?? '')), allowlistForSheet(pack));
  return {
    bottomLineHtml: gated.html ?? '',
    title: deDash(String(out.report_title ?? '')).trim().slice(0, 120),
    dropped: gated.dropped,
  };
}

// Gate all four narrative slots against the pack (used at the save and render
// boundaries; generation already gates before returning). Deterministic.
export function gateSheetNarrative(
  n: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null },
  pack: SheetPack
): SheetNarrative {
  const allow = allowlistForSheet(pack);
  const reading = enforceCitations(n.reading, allow);
  const connections = enforceCitations(n.connections, allow);
  const watch = enforceCitations(n.watch, allow);
  const bottomLine = enforceCitations(n.bottomLine, allow);
  return {
    reading: reading.html,
    connections: connections.html,
    watch: watch.html,
    bottomLine: bottomLine.html,
    citedTags: [...new Set([...reading.cited, ...connections.cited, ...watch.cited, ...bottomLine.cited])].sort(byTagNumber),
    dropped: [...new Set([...reading.dropped, ...connections.dropped, ...watch.dropped, ...bottomLine.dropped])].sort(),
  };
}

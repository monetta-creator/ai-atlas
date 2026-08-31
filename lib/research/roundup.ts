import { marked } from 'marked';
import { runStructured } from '../dossier';
import { enforceCitations, type CitationAllowlist } from '../citations';
import { SHEET_SECTION_TITLES } from '../format';
import {
  getReviewedSince, getThreadsUpdatedSince, getThreadsWithNewPapersSince, getRisingRejects,
  getResearchTouchRollup, getResearchRunStatsSince, getRoundupForWeek,
} from '../data';
import { saveGeneratedReport } from '../mutations';
import { updateThreadSynthesis } from './synthesis';
import type { RoundupPack, RoundupThreadUpdate, SheetNarrative } from '../types';

// The weekly research roundup (every Friday 21:00 UTC, app/api/cron/roundup):
// composes the week's tracked+noted papers, thread updates, and rising rejects
// into a generated_reports row of kind 'roundup', narrates it over two decomposed
// runStructured legs (the lib/tearsheet/generate.ts machine, mirrored here rather
// than shared because a roundup pack does not carry that file's `.signals`/`.node`
// shape), and AUTO-PUBLISHES it (Kevin's 2026-08-30 decision: the one report kind
// that skips the human publish gate).

// ---------------------------------------------------------------- window + text

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekWindow(weekEnd: string): { from: string; to: string } {
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  return { from: isoDay(start), to: weekEnd };
}

function textExcerpt(html: string | null, n: number): string {
  if (!html) return '';
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)} ...` : t;
}

// Belt-and-braces on the writing rule, same as lib/tearsheet/generate.ts.
const deDash = (md: string) => md.replace(/\s*—\s*/g, ', ');

const toHtml = (md: string): string => {
  const clean = deDash(md).trim();
  if (!clean) return '';
  const html = marked.parse(clean, { async: false }) as string;
  return html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
};

// ---------------------------------------------------------------- pack builder

// Threads that gained a confirmed paper this week get their synthesis refreshed
// BEFORE the pack is built, so buildRoundupPack's getThreadsUpdatedSince read
// picks up the fresh text. Best-effort: a failure here just leaves that thread's
// prior synthesis in place, never blocks the roundup.
export async function refreshWeekThreads(from: string, to: string): Promise<void> {
  const candidates = await getThreadsWithNewPapersSince(from, to);
  for (const c of candidates.slice(0, 5)) {
    try {
      const res = await updateThreadSynthesis(c.slug, 'auto: weekly roundup refresh');
      if (!res.ok) console.warn(`[roundup] synthesis refresh skipped for ${c.slug}: ${res.error}`);
    } catch (e) {
      console.warn(`[roundup] synthesis refresh failed for ${c.slug}:`, e);
    }
  }
}

export async function buildRoundupPack(weekEnd: string): Promise<RoundupPack> {
  const { from, to } = weekWindow(weekEnd);
  const [papers, threadRows, newPaperCounts, risingRejects, touchRollup, runStats] = await Promise.all([
    getReviewedSince(from, to),
    getThreadsUpdatedSince(from),
    getThreadsWithNewPapersSince(from, to),
    getRisingRejects(),
    getResearchTouchRollup(),
    getResearchRunStatsSince(from, to),
  ]);

  const newCountBySlug = new Map(newPaperCounts.map((r) => [r.slug, r.new_papers]));
  const threads: RoundupThreadUpdate[] = threadRows.map((t) => ({
    slug: t.slug,
    title: t.title,
    question: t.question,
    synthesis_excerpt: textExcerpt(t.synthesis, 320),
    updated_papers: newCountBySlug.get(t.slug) ?? 0,
  }));

  const papersTracked = papers.filter((p) => p.review_status === 'tracked').length;
  const papersNoted = papers.filter((p) => p.review_status === 'noted').length;
  const findings = papers.filter((p) => !!p.headline_claim).length;

  return {
    kind: 'roundup',
    generatedAt: new Date().toISOString(),
    scopeFrom: from,
    scopeTo: to,
    stats: {
      papersTracked,
      papersNoted,
      findings,
      threadsUpdated: threads.length,
      risingRejects: risingRejects.length,
      runsCompleted: runStats.runsCompleted,
      papersPulled: runStats.papersPulled,
      papersKept: runStats.papersKept,
    },
    papers,
    threads,
    risingRejects,
    touchRollup,
  };
}

// ---------------------------------------------------------------- citation gate

function allowlistForRoundup(pack: RoundupPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const p of pack.papers) {
    const href = `/research/${p.id}`;
    hrefs.add(href);
    tagByHref.set(href, p.arxiv_id ?? p.id.slice(0, 8));
    if (p.url) hrefs.add(p.url);
  }
  for (const t of pack.threads) hrefs.add(`/research/threads/${t.slug}`);
  for (const t of pack.touchRollup) if (t.href) hrefs.add(t.href);
  return { hrefs, tagByHref };
}

// ---------------------------------------------------------------- prompt shape

function fmtRoundupPack(pack: RoundupPack): string {
  const lines: string[] = [];
  lines.push(`WEEKLY RESEARCH ROUNDUP: ${pack.scopeFrom} to ${pack.scopeTo}.`);
  lines.push('');
  lines.push(`PAPERS REVIEWED THIS WEEK (${pack.papers.length}; cite by linking the title to its exact href):`);
  if (!pack.papers.length) {
    lines.push('- none.');
  } else {
    for (const p of pack.papers) {
      lines.push(
        `- [${p.review_status}] "${p.title}" (href /research/${p.id}` +
        `${p.arxiv_id ? `, arXiv ${p.arxiv_id}, href ${p.url}` : ''}, ${p.published_on ?? 'undated'})` +
        `${p.rigor_prior != null ? ` · rigor ${p.rigor_prior}` : ''}` +
        `${p.citation_count != null ? ` · ${p.citation_count} citations` : ''}` +
        `${p.thread_slugs.length ? ` · threads: ${p.thread_slugs.join(', ')}` : ''}` +
        `${p.claim_touches.length ? ` · touches: ${p.claim_touches.join(', ')}` : ''}`
      );
      if (p.headline_claim) lines.push(`    finding: ${p.headline_claim}`);
      if (p.effect_size) lines.push(`    effect: ${p.effect_size}`);
      if (p.econ_implication) lines.push(`    econ implication: ${p.econ_implication}`);
    }
  }
  lines.push('');
  lines.push(`THREADS UPDATED THIS WEEK (${pack.threads.length}; cite with exact href):`);
  if (!pack.threads.length) {
    lines.push('- none.');
  } else {
    for (const t of pack.threads) {
      lines.push(`- "${t.title}" (href /research/threads/${t.slug}): question "${t.question}"`);
      lines.push(`    latest synthesis excerpt: ${t.synthesis_excerpt || '(no synthesis text yet)'}`);
      lines.push(`    ${t.updated_papers} paper${t.updated_papers === 1 ? '' : 's'} confirmed into the thread this week.`);
    }
  }
  if (pack.risingRejects.length) {
    lines.push('');
    lines.push('RISING REJECTS (the funnel passed on these; reference by title only, do not link):');
    for (const r of pack.risingRejects) {
      lines.push(`- "${r.title}" (${r.review_status}, ${r.citation_count} citations)${r.triage_reason ? `: ${r.triage_reason}` : ''}`);
    }
  }
  if (pack.touchRollup.length) {
    lines.push('');
    lines.push('ARGUMENT MAP TOUCHES (advisory; cite with exact href when present):');
    for (const t of pack.touchRollup) {
      lines.push(`- ${t.code}${t.href ? ` (href ${t.href})` : ' (no longer on the map)'}: ${t.statement ?? 'n/a'} · ${t.paper_count} paper${t.paper_count === 1 ? '' : 's'}`);
    }
  }
  lines.push('');
  lines.push('STATISTICS (authoritative, computed in code; use these exact numbers):');
  const s = pack.stats;
  lines.push(`- ${s.papersTracked} tracked, ${s.papersNoted} noted this week (${s.findings} carry an extracted finding).`);
  lines.push(`- ${s.threadsUpdated} thread${s.threadsUpdated === 1 ? '' : 's'} refreshed; ${s.risingRejects} rising reject${s.risingRejects === 1 ? '' : 's'} on watch.`);
  if (s.runsCompleted != null) {
    lines.push(`- ${s.runsCompleted} discovery run${s.runsCompleted === 1 ? '' : 's'} completed, pulling ${s.papersPulled ?? 0} new papers, keeping ${s.papersKept ?? 0}.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- narrative

const VOICE =
  `You are writing the weekly research roundup for The AI Atlas, a tool for staying oriented in ` +
  `the AI-economy debate. You receive a frozen weekly pack: papers reviewed this week with their ` +
  `extracted findings, thread updates, rising rejects, and computed statistics. Write ONLY from ` +
  `this pack. The voice is weekly editorial: what moved in AI research this week, for a reader ` +
  `deciding what to pay attention to. Cite papers by linking their titles as markdown links using ` +
  `the EXACT href provided, e.g. [a paper title](/research/1234-uuid); never a bare title. When ` +
  `you reference a claim or bridge-claim, paraphrase its statement and link the phrase to its ` +
  `EXACT href. Do not link to anything outside the pack. Never invent a paper, finding, number, or ` +
  `URL; the STATISTICS block is authoritative, use its exact figures. No fluff, no throat-clearing: ` +
  `every sentence carries a fact from the pack or a judgment grounded in one. If the week was ` +
  `quiet, say so plainly. Write like a careful research editor: confident where the evidence is ` +
  `strong, explicit where it is thin. Tight paragraphs, bullets where they help. Output ` +
  `GitHub-flavored MARKDOWN. Do not begin with a heading. Never use an em dash in your output; use ` +
  `a comma, a colon, or separate sentences instead.`;

const SECTION_BRIEF =
  `"reading", titled "${SHEET_SECTION_TITLES.roundup.reading}" by the app: what moved in AI ` +
  `research this week, weaving the strongest tracked and noted findings with citations, 200 to ` +
  `320 words. "connections", titled "${SHEET_SECTION_TITLES.roundup.connections}" by the app: how ` +
  `this week's papers connect into the open research threads and the Argument Map, synthesized, ` +
  `not listed, 120 to 220 words. "watch", titled "${SHEET_SECTION_TITLES.roundup.watch}" by the ` +
  `app: rising rejects worth a second look, thin coverage, and what to watch next week, 100 to ` +
  `180 words.`;

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

export interface RoundupSectionsOut {
  readingMd: string;
  connectionsMd: string;
  watchMd: string;
  readingHtml: string;
  connectionsHtml: string;
  watchHtml: string;
  dropped: string[];
}

export async function generateRoundupSections(pack: RoundupPack): Promise<RoundupSectionsOut> {
  const out = await runStructured<{ reading?: string; connections?: string; watch?: string }>({
    system: `${VOICE} Produce the three body sections of the roundup. ${SECTION_BRIEF} All three are markdown bodies only, no headings.`,
    user: fmtRoundupPack(pack),
    toolName: 'submit_roundup_sections',
    toolDescription: 'Return the three markdown body sections of the weekly research roundup.',
    schema: SECTIONS_SCHEMA,
    maxTokens: 2000,
    effort: 'medium',
    feature: 'roundup_sections',
    metadata: { scopeFrom: pack.scopeFrom, scopeTo: pack.scopeTo },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const readingMd = String(out.reading ?? '');
  const connectionsMd = String(out.connections ?? '');
  const watchMd = String(out.watch ?? '');
  const allow = allowlistForRoundup(pack);
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
  `"bottom_line": a single standalone paragraph of roughly 60 to 120 words that begins with ` +
  `"**Bottom line:**" (bold) and gives the reader's takeaway: what mattered this week and the ` +
  `single most important thing to watch next. Synthesize across the sections, do not repeat them. ` +
  `Also produce "report_title": a short editorial title for this week's roundup, in the form ` +
  `"Research roundup, week of <Month Day>" using the week's ending date, at most 10 words, plain ` +
  `text, no quotes, and do not include the words "AI Atlas".`;

const CLOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bottom_line: { type: 'string' }, report_title: { type: 'string' } },
  required: ['bottom_line', 'report_title'],
};

export async function generateRoundupClose(
  pack: RoundupPack,
  sections: { readingMd: string; connectionsMd: string; watchMd: string }
): Promise<{ bottomLineHtml: string; title: string; dropped: string[] }> {
  const titles = SHEET_SECTION_TITLES.roundup;
  const user = [
    fmtRoundupPack(pack),
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
    toolName: 'submit_roundup_close',
    toolDescription: 'Return the bottom-line paragraph and an editorial title for the weekly roundup.',
    schema: CLOSE_SCHEMA,
    maxTokens: 700,
    effort: 'medium',
    feature: 'roundup_close',
    metadata: { scopeFrom: pack.scopeFrom, scopeTo: pack.scopeTo },
    timeoutMs: 55_000,
    maxRetries: 0,
  });
  const gated = enforceCitations(toHtml(String(out.bottom_line ?? '')), allowlistForRoundup(pack));
  return {
    bottomLineHtml: gated.html ?? '',
    title: deDash(String(out.report_title ?? '')).trim().slice(0, 120) || `Research roundup, week of ${pack.scopeTo}`,
    dropped: gated.dropped,
  };
}

// Re-gate all four narrative slots against the pack (the save + render
// boundaries; generation already gates before returning). Deterministic. The
// roundup analog of lib/tearsheet/generate.ts's gateSheetNarrative.
export function gateRoundupNarrative(
  n: { reading: string | null; connections: string | null; watch: string | null; bottomLine: string | null },
  pack: RoundupPack
): SheetNarrative {
  const allow = allowlistForRoundup(pack);
  const reading = enforceCitations(n.reading, allow);
  const connections = enforceCitations(n.connections, allow);
  const watch = enforceCitations(n.watch, allow);
  const bottomLine = enforceCitations(n.bottomLine, allow);
  return {
    reading: reading.html,
    connections: connections.html,
    watch: watch.html,
    bottomLine: bottomLine.html,
    citedTags: [...new Set([...reading.cited, ...connections.cited, ...watch.cited, ...bottomLine.cited])].sort(),
    dropped: [...new Set([...reading.dropped, ...connections.dropped, ...watch.dropped, ...bottomLine.dropped])].sort(),
  };
}

// ---------------------------------------------------------------- orchestrator

// The cron's whole unit. Errors propagate to the caller (the route wraps this
// in try/catch and returns the error as data); everything else here is a
// deliberate, typed skip.
export async function runWeeklyRoundup(): Promise<{ reportId: string } | { skipped: string }> {
  const weekEnd = isoDay(new Date());

  const existing = await getRoundupForWeek(weekEnd);
  if (existing) return { skipped: `already complete for the week ending ${weekEnd}` };

  const { from, to } = weekWindow(weekEnd);
  await refreshWeekThreads(from, to);

  const pack = await buildRoundupPack(weekEnd);
  if (pack.papers.length === 0 && pack.threads.length === 0) {
    return { skipped: 'quiet week: no reviewed papers' };
  }

  const sections = await generateRoundupSections(pack);
  const close = await generateRoundupClose(pack, sections);
  const narrative: SheetNarrative = gateRoundupNarrative(
    {
      reading: sections.readingHtml,
      connections: sections.connectionsHtml,
      watch: sections.watchHtml,
      bottomLine: close.bottomLineHtml,
    },
    pack
  );

  const reportId = await saveGeneratedReport({
    kind: 'roundup',
    subject: null,
    title: close.title,
    scope_from: pack.scopeFrom,
    scope_to: pack.scopeTo,
    pack,
    narrative,
    generated_at: pack.generatedAt,
    isPublished: true,
  });
  return { reportId };
}

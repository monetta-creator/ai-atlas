import { marked } from 'marked';
import { routedStructured } from '../model-route';
import { enforceCitations } from '../citations';
import { coverageLine } from './cluster';
import type { StoryCluster } from './cluster';
import { allowlistForEdition, deDash, validateFrontItems } from './pack';
import type { RawFrontItem } from './pack';
import type { EditionPack, EditionFrontItem } from './types';

// The daily edition's two model legs (the roundup template, lib/research/
// roundup.ts): leg 1 (generateFront) picks and writes the front page from the
// ranked clusters; leg 2 (generateColumn) writes the Levine-style column that
// connects today's stories to the claims they touch. Both run on the cheap
// provider (edition_prefs.model, default GLM) via routedStructured, which
// dispatches Anthropic ids through runStructured and OpenRouter ids through
// the scan's JSON-object path. deterministicFront (lib/edition/pack.ts) is
// the no-model fallback lib/edition/run.ts reaches for when the daily budget
// is spent.

const toHtml = (md: string): string => {
  const clean = deDash(md).trim();
  if (!clean) return '';
  const html = marked.parse(clean, { async: false }) as string;
  return html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');
};

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\s+[^>]*href="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------- leg 1: front

function fmtCluster(c: StoryCluster): string {
  const lines: string[] = [];
  lines.push(`CLUSTER ${c.id}: "${c.lead.headline}" (lead href/url: ${c.lead.href ?? c.lead.url})`);
  lines.push(
    `  coverage: ${coverageLine(c)} (tier mix 1=${c.tierMix['1']} 2=${c.tierMix['2']} 3=${c.tierMix['3']} 4=${c.tierMix['4']} unknown=${c.tierMix.unknown})`
  );
  for (const it of c.items.slice(0, 3)) {
    lines.push(`  - "${it.headline}" (${it.domain || 'unknown outlet'}, href/url: ${it.href ?? it.url})`);
    if (it.summary) lines.push(`      summary: ${it.summary}`);
  }
  if (c.entities.length) lines.push(`  entities: ${c.entities.slice(0, 6).join(', ')}`);
  return lines.join('\n');
}

const FRONT_SYSTEM =
  `You are writing the FRONT PAGE of The AI Atlas's daily edition, a tool for staying oriented in ` +
  `the AI-economy debate. You receive today's ranked story clusters (each already deduplicated ` +
  `across outlets, most significant first). Pick the strongest clusters and write one Axios-style ` +
  `Smart Brevity item per cluster: one idea, a bold-worthy headline, a "why it matters" of one or ` +
  `two sentences, and an optional one-sentence "by the numbers" line using ONLY figures present in ` +
  `the cluster text (a percent, a dollar figure, a count). Never invent a number. Never invent a ` +
  `fact not in the cluster. goDeeperHref MUST be copied EXACTLY from the href/url shown for that ` +
  `cluster's lead item or one of its other items, never invented or altered. clusterId MUST be ` +
  `copied exactly from the "CLUSTER <id>" line. Write for a reader deciding what to pay attention ` +
  `to today, plain and confident, no fluff, no praise, no throat-clearing. Never use an em dash; ` +
  `use a comma, a colon, or separate sentences instead.`;

const FRONT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clusterId: { type: 'string', description: 'copied exactly from a "CLUSTER <id>" line' },
          headline: { type: 'string' },
          why: { type: 'string', description: 'why it matters, one or two sentences' },
          numbers: { type: 'string', description: 'by the numbers, one sentence, or empty string if none apply' },
          goDeeperHref: { type: 'string', description: 'copied exactly from the cluster' },
        },
        required: ['clusterId', 'headline', 'why', 'numbers', 'goDeeperHref'],
      },
    },
  },
  required: ['items'],
};

export async function generateFront(pack: EditionPack, model: string, n: number): Promise<EditionFrontItem[]> {
  const top = pack.clusters.slice(0, Math.min(n + 3, 10));
  if (!top.length) return [];
  const user = [
    `DAY: ${pack.day} (issue No. ${pack.issueNumber})`,
    `Pick the ${n} strongest of the clusters below for the front page, ranked order.`,
    '',
    ...top.map(fmtCluster),
  ].join('\n\n');
  const out = await routedStructured<{ items?: RawFrontItem[] }>({
    model,
    system: FRONT_SYSTEM,
    user,
    toolName: 'submit_front',
    toolDescription: "Return the daily edition's front-page items, one per chosen cluster.",
    schema: FRONT_SCHEMA,
    maxTokens: 2200,
    timeoutMs: 60_000,
    feature: 'edition_front',
    metadata: { day: pack.day },
  });
  const items = Array.isArray(out.items) ? out.items : [];
  return validateFrontItems(top, items, n);
}

// ---------------------------------------------------------------- leg 2: column

function fmtClaimsTouched(pack: EditionPack): string {
  if (!pack.claimsTouched.length) return 'none this window.';
  return pack.claimsTouched
    .map(
      (c) =>
        `- ${c.code} (href ${c.href}): ${c.statement}` +
        `${c.signalHrefs.length ? ` [carried by signal(s): ${c.signalHrefs.join(', ')}]` : ''}`
    )
    .join('\n');
}

const COLUMN_SYSTEM =
  `You are writing THE COLUMN of The AI Atlas's daily edition, in the style of Matt Levine's Money ` +
  `Stuff: one voice, two or three beats under plain sub-headers, connecting the day's news to the ` +
  `standing claims The AI Atlas tracks. You receive today's front-page items and the claims/bridge-` +
  `claims that today's published signals touch. Connect AT LEAST TWO of today's front items to the ` +
  `claims they bear on: name what would move the claim's confidence, one way or the other. Link a ` +
  `claim by wrapping its exact statement text (or a short paraphrase) in a markdown link using its ` +
  `EXACT href, e.g. [this claim](/claim/1.2); never invent an href or link outside what you were ` +
  `given. 350 to 550 words. End with one wry but factual closing line, never sarcasm that undercuts ` +
  `a fact. No fluff, no praise, no throat-clearing. Never use an em dash; use a comma, a colon, or ` +
  `separate sentences instead. Output GitHub-flavored MARKDOWN in "body_md", no heading at the top ` +
  `(the title is separate). "title" is a short editorial title for today's column, at most 10 words, ` +
  `plain text, no quotes.`;

const COLUMN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    body_md: { type: 'string' },
  },
  required: ['title', 'body_md'],
};

export interface ColumnOut {
  title: string;
  html: string;
  cited: string[];
  dropped: string[];
}

export async function generateColumn(pack: EditionPack, front: EditionFrontItem[], model: string): Promise<ColumnOut> {
  const user = [
    `DAY: ${pack.day} (issue No. ${pack.issueNumber})`,
    '',
    "TODAY'S FRONT ITEMS:",
    ...front.map((f) => `- "${f.headline}" (href ${f.goDeeperHref}): ${f.why}`),
    '',
    'CLAIMS/BRIDGES ON THE ARGUMENT MAP TOUCHED BY SIGNALS PUBLISHED THIS WINDOW (cite with the exact href):',
    fmtClaimsTouched(pack),
  ].join('\n');
  const out = await routedStructured<{ title?: string; body_md?: string }>({
    model,
    system: COLUMN_SYSTEM,
    user,
    toolName: 'submit_column',
    toolDescription: "Return the daily edition's column: a short title and the markdown body.",
    schema: COLUMN_SCHEMA,
    maxTokens: 1800,
    timeoutMs: 60_000,
    feature: 'edition_column',
    metadata: { day: pack.day },
  });
  const html = toHtml(String(out.body_md ?? ''));
  const gated = enforceCitations(html, allowlistForEdition(pack));
  const dropped = [...gated.dropped];

  // Gate 2: the column's whole point is connecting news to claims. Keep it
  // either way (a quiet window may not have two live claim connections) but
  // record the shortfall for the admin audit, same discipline as `dropped`.
  const claimHrefs = new Set(pack.claimsTouched.map((c) => c.href));
  const claimLinks = extractHrefs(gated.html ?? '').filter((h) => claimHrefs.has(h)).length;
  if (claimLinks < 2) dropped.push(`fewer than 2 claim links (${claimLinks})`);

  return {
    title: deDash(String(out.title ?? '')).trim().slice(0, 120) || `Daily edition, ${pack.day}`,
    html: gated.html ?? '',
    cited: gated.cited,
    dropped,
  };
}

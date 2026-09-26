// The daily edition's AI gate and desks (2026-09-26). PLAIN-NODE LOADABLE:
// no imports beyond types, so scripts/test-edition.mjs and the paper/deck
// builders can load it under plain `node`.
//
// Two jobs. (1) isAiStory decides whether an item belongs in an AI paper at
// all: the engines' relevance is TOPIC fit (a bank-capital story scores high
// on a banking topic), so the front page and Things happen gate on this and
// the strongest non-AI financial-services items go to their own strip, "The
// industry". (2) deskFor files an AI item under a desk (Labs & models, Chips
// & infrastructure, Policy & regulation, ...) so Things happen reads as a
// newspaper's briefs page instead of a wall of cards.

import type { StoryItem } from './cluster';
import type { EditionBlindSpot, EditionThing } from './types';

// The vocabulary that marks a story as about AI. Pipeline candidates and
// published signals came through the AI lenses and always count (see
// isAiStory), so this list only has to catch the scan/intel long tail:
// labs, models, agents, and the hardware/energy stack underneath them.
export const AI_TERMS =
  /\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|llm|llms|language model|foundation model|frontier model|frontier lab|generative|gen ai|genai|agentic|ai agent|agents?\b.*\b(model|llm|copilot)|copilot|chatbot|openai|anthropic|claude|gpt|gemini|llama|mistral|deepseek|xai|grok|perplexity|nvidia|gpu|gpus|tpu|accelerator|inference|training run|data center|datacenter|hyperscaler|compute|semiconductor|chips?\b|hbm|tsmc|foundry|wafer|lithography|asml|hugging face|transformer|multimodal|rag\b|vector database|fine-?tun|open-?weights?|model release|benchmark|robotics?|autonomous|self-driving|neural)/i;

export type AiStoryInput = Pick<StoryItem, 'source' | 'headline'> &
  Partial<Pick<StoryItem, 'summary' | 'tags' | 'entities'>>;

export function isAiStory(it: AiStoryInput): boolean {
  if (it.source === 'pipeline' || it.source === 'signal') return true;
  const hay = `${it.headline} ${it.summary ?? ''} ${(it.tags ?? []).join(' ')} ${(it.entities ?? []).join(' ')}`;
  return AI_TERMS.test(hay);
}

// ---------------------------------------------------------------- desks

export type DeskKey = 'labs' | 'chips' | 'policy' | 'finance' | 'work' | 'business' | 'research' | 'other';

export const DESK_LABELS: Record<DeskKey, string> = {
  labs: 'Labs & models',
  chips: 'Chips & infrastructure',
  policy: 'Policy & regulation',
  finance: 'Banks & payments',
  work: 'Work & labor',
  business: 'Deals & markets',
  research: 'Research & evidence',
  other: 'Elsewhere',
};

export const DESK_KEYS = Object.keys(DESK_LABELS) as DeskKey[];

export function isDeskKey(v: unknown): v is DeskKey {
  return typeof v === 'string' && v in DESK_LABELS;
}

// Ordered rules, first hit wins. Policy comes first (an executive order
// that "directs a study" is policy), research second (a study about chips is
// research), and labs last among the specific desks because nearly every AI
// headline names a model or a lab, so it is the residual before "other".
const DESK_RULES: { desk: DeskKey; re: RegExp }[] = [
  { desk: 'policy', re: /\b(regulat\w*|executive order|court|bill|act\b|senate|congress|eu\b|european commission|commission|nist|doj|ftc|sec\b|occ|cfpb|treasury secretary|licens\w*|safety standards?|treaty|un\b|security council|export controls?|sanctions?|tariffs?|lawmakers?|legislat\w*|attorney general|white house|governor)\b/i },
  { desk: 'research', re: /\b(study|studies|paper|survey|finds|found|peer-reviewed|researchers|evidence|report details|analysis shows|working paper)\b/i },
  { desk: 'chips', re: /\b(chips?|gpus?|hbm|tsmc|semiconductors?|foundry|wafers?|data ?centers?|compute|power grid|grid|energy|nuclear|cooling|packaging|memory|lithography|asml|nvidia|accelerators?|hyperscalers?)\b/i },
  { desk: 'work', re: /\b(hiring|hires?|jobs?|workforce|layoffs?|union|employees|apprentices?|talent|labor|workers|productivity|headcount|staff)\b/i },
  { desk: 'finance', re: /\b(banks?|banking|payments?|fintech|cards?|lending|lenders?|loans?|credit|deposits?|insurers?|wallet|checkout|fraud|kyc|treasury|clearing|underwriting|mortgage)\b/i },
  { desk: 'business', re: /\b(raises?|raised|funding|series [a-e]|valuation|acqui\w*|ipo|revenue|earnings|deal|partnership|stock|shares|invest\w*|merger|buyout)\b/i },
  { desk: 'labs', re: /\b(models?|llms?|openai|anthropic|google|deepmind|meta|mistral|deepseek|xai|grok|agents?|copilot|chatbot|release[sd]?|launch\w*|api|benchmarks?|safety evals?|evaluations?|claude|gpt|gemini|llama)\b/i },
];

// Intel dimension tags carry a desk of their own before the text is read.
const TAG_DESK: Record<string, DeskKey> = {
  regulatory: 'policy',
  talent: 'work',
  financials: 'business',
  ma_partnerships: 'business',
};

export interface DeskInput {
  headline: string;
  summary?: string | null;
  tags?: string[] | null;
  entities?: string[] | null;
}

export function deskFor(input: DeskInput): DeskKey {
  for (const t of input.tags ?? []) {
    const d = TAG_DESK[t];
    if (d) return d;
  }
  // The headline decides first; the summary only breaks a tie the headline
  // could not (a headline is written to say what the story is about).
  for (const hay of [input.headline, `${input.headline} ${input.summary ?? ''}`]) {
    for (const r of DESK_RULES) if (r.re.test(hay)) return r.desk;
  }
  return 'other';
}

export interface DeskGroup {
  desk: DeskKey;
  label: string;
  items: EditionThing[];
}

// Group things by desk: biggest desk first, "Elsewhere" last, empty desks
// omitted. A stored `desk` stamp is trusted only when it is a live key (the
// first four editions carry none and group from the headline).
export function groupByDesk(things: EditionThing[]): DeskGroup[] {
  const map = new Map<DeskKey, EditionThing[]>();
  for (const t of things) {
    const desk = isDeskKey(t.desk) ? t.desk : deskFor({ headline: t.headline });
    const arr = map.get(desk) ?? [];
    arr.push(t);
    map.set(desk, arr);
  }
  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === 'other') return 1;
      if (b[0] === 'other') return -1;
      return b[1].length - a[1].length || DESK_KEYS.indexOf(a[0]) - DESK_KEYS.indexOf(b[0]);
    })
    .map(([desk, items]) => ({ desk, label: DESK_LABELS[desk], items }));
}

// Greedy column balancing: largest group first into the lightest column.
// Returns min(n, groups.length) columns so a two-desk day never renders an
// empty column. Shared by the web view (CSS handles it there) and the paper.
export function balanceColumns<T>(groups: T[], n: number, weight: (g: T) => number): T[][] {
  const cols = Math.max(1, Math.min(n, groups.length));
  const out: T[][] = Array.from({ length: cols }, () => []);
  const load = new Array<number>(cols).fill(0);
  const sorted = [...groups].sort((a, b) => weight(b) - weight(a));
  for (const g of sorted) {
    let best = 0;
    for (let i = 1; i < cols; i += 1) if (load[i] < load[best]) best = i;
    out[best].push(g);
    load[best] += weight(g);
  }
  return out;
}

// ---------------------------------------------------------------- blind spots

export interface RawDevelopment {
  headline: string;
  url?: string | null;
  covered: boolean;
}

// The coverage check's misses arrive as raw GDELT/Tavily titles: a bare site
// name ("Fortune"), an earnings-call transcript, a fund ticker page. Keep
// only what reads as an AI headline. Applied at pack build AND at render, so
// the editions stored before this existed clean up too.
const JUNK_RE = /earnings call transcript|\b[A-Z]{2,6}:[A-Z]{2}\b|stock quote|price target|\bfund\b|\betf\b/i;

export function cleanBlindSpots(devs: RawDevelopment[], limit = 6): EditionBlindSpot[] {
  const seen = new Set<string>();
  const out: EditionBlindSpot[] = [];
  for (const d of devs) {
    if (d.covered) continue;
    const headline = (d.headline ?? '').trim();
    if (headline.split(/\s+/).filter(Boolean).length < 4) continue;
    if (JUNK_RE.test(headline)) continue;
    if (!isAiStory({ source: 'scan', headline })) continue;
    const url = d.url ?? null;
    if (url) {
      try {
        const u = new URL(url);
        if (u.pathname === '/' || u.pathname === '') continue;
      } catch {
        continue;
      }
    }
    const key = headline.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ headline, url });
    if (out.length >= limit) break;
  }
  return out;
}

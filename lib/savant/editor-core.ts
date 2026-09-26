// Savant's deterministic editorial checks (2026-09-26). PLAIN-NODE LOADABLE:
// type imports only. These run before the editor persona reads the draft and
// are handed to it as "automated checks that fired": machinery words in
// prose, bare position codes, em dashes, a sentence naming the reader
// organization with no linked record in its paragraph, the lead's length,
// summary bullets without a link, a missing "What we will watch" close.

import type { SavantDepartment, HypothesisReading, SelfCompany } from './types';

export interface Draft {
  title: string;
  summary: string[];          // html
  leadHtml: string;
  leadMarkdown: string;
  freshHtml: string | null;
  readings: HypothesisReading[];
  departments: SavantDepartment[];
}

export const stripTags = (html: string): string => html.replace(/<a\s[^>]*>/g, '').replace(/<\/a>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Machinery words and bare position codes, judged on prose (link targets removed).
const BANNED = /\b(bridge-claim|argument map|logic tree|confidence (?:level|score|number)s?|the claim that|this claim|claim \d)\b/i;
// Bare bridge and stance codes read as machinery; decimal claim codes are
// not checked here (a "1.5 per week" or "Opus 5.5" is ordinary prose), the
// editor persona judges those with the text in front of it.
const CODE_IN_PROSE = /(^|[\s(])(B\d|Q\d-S\d[A-C]|S\d[A-C])(?=[\s).,;:]|$)/;

export function deterministicChecks(d: Draft, self: SelfCompany | null): string[] {
  const out: string[] = [];
  const sections: [string, string][] = [
    ['summary', d.summary.join(' ')], ['lead', d.leadHtml], ['hypotheses', [d.freshHtml ?? '', ...d.readings.map((r) => r.html)].join(' ')],
    ...d.departments.map((x): [string, string] => [x.key, x.html]),
  ];
  for (const [name, html] of sections) {
    const prose = stripTags(html);
    if (/—/.test(prose)) out.push(`${name}: em dash present`);
    const b = prose.match(BANNED);
    if (b) out.push(`${name}: machinery word "${b[0]}"`);
    const c = prose.match(CODE_IN_PROSE);
    if (c) out.push(`${name}: bare position code "${c[2]}" in prose`);
    // The peer watch's figures are the Atlas's own counts from public items,
    // printed as tables in Appendix B; a sentence there needs no per-sentence link.
    if (self?.name && name !== 'peers') {
      // A sentence naming the reader organization must sit in a paragraph with a link.
      const paras = html.split(/<\/p>|<\/li>/i);
      for (const p of paras) {
        if (p.includes(self.name) && !/<a\s/i.test(p)) { out.push(`${name}: a sentence names ${self.name} with no linked record in its paragraph`); break; }
      }
    }
  }
  const words = stripTags(d.leadHtml).split(/\s+/).filter(Boolean).length;
  if (words < 1200) out.push(`lead: ${words} words, under the 1,500 floor`);
  if (words > 2900) out.push(`lead: ${words} words, over the 2,500 ceiling`);
  if (d.summary.length < 4) out.push(`summary: ${d.summary.length} bullets, wants 5`);
  d.summary.forEach((s, i) => { if (!/<a\s/i.test(s)) out.push(`summary: bullet ${i + 1} has no link`); });
  if (!stripTags(d.leadHtml).toLowerCase().includes('what we will watch')) out.push('lead: no "What we will watch" close');
  return out;
}



// Numbers a text asserts (integers, decimals, percents, dollar figures),
// normalized. A revision may drop numbers or rephrase them; it may not
// introduce a number the original never stated (the 2026-09-26 regeneration
// turned "8 AI-related items" into "0 items" while re-leading a paragraph).
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/<[^>]+>/g, ' ').matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) out.add(m[0].replace(/[$,%]/g, ''));
  return out;
}

export function revisionKeepsFigures(original: string, revised: string, allowed: Set<string> = new Set()): boolean {
  const before = numbersIn(original);
  for (const n of numbersIn(revised)) if (!before.has(n) && !allowed.has(n)) return false;
  return true;
}

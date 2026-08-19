import { enforceCitations, byTagNumber, type CitationAllowlist } from '../citations';
import type { ThesisNarrative, ThesisPack } from '../types';

// The thesis citation gate: builds the thesis pack's allowlist and gates all
// three narrative slots. The generic enforcement core lives in lib/citations.ts
// (shared with the tear-sheet generators); this module owns only what is
// thesis-shaped. Runs at generation time AND again at the save/render boundaries
// (same belt-and-braces as sanitizeReportNarrative).

export type { CitationAllowlist };
export { enforceCitations };

export function allowlistFor(pack: ThesisPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const s of pack.signals) {
    const href = `/signals/${s.id}`;
    hrefs.add(href);
    tagByHref.set(href, s.tag);
    if (s.source_url) hrefs.add(s.source_url);
  }
  for (const c of pack.claims) hrefs.add(c.href);
  return { hrefs, tagByHref };
}

// Gate all three narrative slots against the pack and produce the audit fields.
// Deterministic: same HTML + same pack always yields the same result.
export function gateThesisNarrative(
  n: { reading: string | null; counterweight: string | null; bottomLine: string | null },
  pack: ThesisPack
): ThesisNarrative {
  const allow = allowlistFor(pack);
  const reading = enforceCitations(n.reading, allow);
  const counterweight = enforceCitations(n.counterweight, allow);
  const bottomLine = enforceCitations(n.bottomLine, allow);
  return {
    reading: reading.html,
    counterweight: counterweight.html,
    bottomLine: bottomLine.html,
    citedTags: [...new Set([...reading.cited, ...counterweight.cited, ...bottomLine.cited])].sort(byTagNumber),
    dropped: [...new Set([...reading.dropped, ...counterweight.dropped, ...bottomLine.dropped])].sort(),
  };
}

import { enforceCitations, byTagNumber, type CitationAllowlist } from '../citations';
import type { HypothesisNarrative, HypothesisPack } from '../types';

// The hypothesis-report citation gate: builds the pack's allowlist and gates all
// three narrative slots. The generic enforcement core lives in lib/citations.ts;
// this module owns only what is pack-shaped. Runs at generation time AND again
// at the save/render boundaries (belt-and-braces, like sanitizeReportNarrative).

export type { CitationAllowlist };
export { enforceCitations };

export function allowlistFor(pack: HypothesisPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const s of pack.signals) {
    const href = `/signals/${s.id}`;
    hrefs.add(href);
    tagByHref.set(href, s.tag);
    if (s.source_url) hrefs.add(s.source_url);
  }
  hrefs.add(`/hypothesis/${pack.code}`);
  return { hrefs, tagByHref };
}

// Gate all three narrative slots against the pack and produce the audit fields.
// Deterministic: same HTML + same pack always yields the same result.
export function gateHypothesisNarrative(
  n: { reading: string | null; counterweight: string | null; bottomLine: string | null },
  pack: HypothesisPack
): HypothesisNarrative {
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

import type { CitationAllowlist } from '../citations';
import type { FieldReportPack } from './core';

// A Field Report's citation allow-list: every Atlas record the research leg
// gathered (already an in-app path, /claim/..., /signals/<id>, ...) plus
// every web source, plus the query-stripped twin of a web url (models drop
// tracking params, the edition's own lesson). Shared by the web read view
// and the PDF so both re-gate against exactly the same set, belt and braces
// with the engine's own gate at save time (lib/savant/allowlist.ts is the
// same pattern for Savant).

export function allowlistForFieldReport(pack: FieldReportPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const r of pack.records) {
    hrefs.add(r.href);
    tagByHref.set(r.href, r.tag);
  }
  for (const w of pack.web) {
    hrefs.add(w.url);
    const bare = w.url.replace(/[?#].*$/, '');
    if (bare !== w.url) hrefs.add(bare);
  }
  return { hrefs, tagByHref };
}

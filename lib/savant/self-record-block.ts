import type { SelfCompany } from './types';

// The reader organization's cited public record (mig 0076), formatted for a
// prompt: every profile sentence followed by its links, then the recent
// timeline, each event with its own links. Used by plan.ts, lead.ts and
// write.ts wherever they already print the org's name + public_blurb, so a
// sentence about the reader organization can cite something more than the
// one-line blurb. Returns '' when the profile and timeline are both empty
// (a fresh install, or before the backfill has run) so callers can drop it
// with a plain `.filter(Boolean)`.
export function selfRecordBlock(self: SelfCompany): string {
  if (!self.profile.length && !self.timeline.length) return '';
  const lines: string[] = ['READER ORGANIZATION PUBLIC RECORD (every line cites a public record; link it when you use it):'];
  for (const p of self.profile) {
    lines.push(`- ${p.text}${p.hrefs.length ? ` [${p.hrefs.join(', ')}]` : ''}`);
  }
  if (self.timeline.length) {
    lines.push('RECENT TIMELINE:');
    for (const t of self.timeline) {
      lines.push(`- ${t.date}: ${t.headline}${t.hrefs.length ? ` [${t.hrefs.join(', ')}]` : ''}`);
    }
  }
  return lines.join('\n');
}

import { q } from '../db';
import type { FieldReportNarrative, FieldReportPack } from './core';

// Follow-ups (docs/field-report.md): a question asked after a Field Report in
// the same conversation carries the report ids; the Ask routes add the
// reports' text as context so "expand on the second section" works. Access
// is the read view's rule: admin reads any; a keyholder reads their own or a
// published report. Clipped so a long report cannot crowd out the records.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (html: string) => html.replace(/<a [^>]*>(\d+)<\/a>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export async function fieldReportContextBlock(ids: unknown, who: { admin: boolean; keyId: string | null }): Promise<string | null> {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((id) => UUID_RE.test(id)).slice(0, 3);
  if (!list.length) return null;
  const rows = await q<{ id: string; title: string; is_published: boolean; created_by: string | null; pack: FieldReportPack; narrative: FieldReportNarrative }>(
    `select id::text, title, is_published, created_by, pack, narrative from generated_reports where kind = 'field_report' and id = any($1::uuid[])`,
    [list]
  );
  const visible = rows.filter((r) => who.admin || r.is_published || (who.keyId && r.created_by === `key:${who.keyId}`));
  if (!visible.length) return null;
  const blocks = visible.map((r) => {
    const summary = r.narrative.summary.map((b) => `- ${text(b.html)}`).join('\n');
    const sections = r.narrative.sections.map((s, i) => {
      const body = s.blocks.map((b) => `${b.prov === 'analysis' ? '(the report\'s own analysis) ' : ''}${text(b.html)}`).join(' ');
      return `SECTION ${i + 1}: ${s.title}\n${body.slice(0, 1400)}`;
    }).join('\n\n');
    return `FIELD REPORT "${r.title}" (the question: ${r.pack.question})\nSUMMARY:\n${summary}\n\n${sections}`.slice(0, 9000);
  });
  return `A FIELD REPORT WAS WRITTEN EARLIER IN THIS CONVERSATION. The person may ask about it ("expand on section 2", "what did it say about..."). Answer from the report below together with the Atlas records; say "the report" when you draw on it, keep citing Atlas records by tag as usual, and never invent what the report said.\n\n${blocks.join('\n\n---\n\n')}`;
}

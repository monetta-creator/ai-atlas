import { runStructured } from '../dossier';
import { getAllDraftSignals } from '../data';
import type { DedupeRecommendation, DedupeGroup, DedupeMember } from '../types';

// Qualitative dedupe (MANUAL, admin-triggered from the Draft queue). Scans ALL unpublished
// drafts and groups those that report the SAME development from different sources — semantic,
// not exact-title. Recommend-only: the admin merges or discards; the human commits. Distinct
// from triage's 'duplicate' (which compares candidate headlines to ALREADY-EXISTING signals,
// pre-analysis); this compares finished draft summaries to each other. One non-web structured
// call (the input — titles + summaries — is small).

const DEDUPE_SYSTEM = [
  'You are deduplicating a batch of draft intelligence-board entries, each written from one source.',
  'Group entries that report THE SAME underlying development — the same event, deal, filing, model release, or data point — even when the wording, framing, or source differs.',
  'Do NOT group items that are merely on the same topic or theme; only true same-story restatements belong together.',
  'For each group of 2 or more, choose the single best entry as canonical (the clearest, most complete, most authoritative) and list the others as its duplicates.',
  'A draft with no genuine duplicate must NOT appear in any group. Give a one-clause reason per group, and never use an em dash in it.',
].join(' ');

const DEDUPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          canonical_index: { type: 'integer' },
          duplicate_indexes: { type: 'array', items: { type: 'integer' } },
          reason: { type: 'string' },
        },
        required: ['canonical_index', 'duplicate_indexes', 'reason'],
      },
    },
  },
  required: ['groups'],
};

// Bound the batch so the single call stays well inside 60s and the output isn't truncated.
const DEDUPE_MAX = 60;

export async function dedupeAllDrafts(): Promise<DedupeRecommendation> {
  const drafts = await getAllDraftSignals();
  const generated_at = new Date().toISOString();
  if (drafts.length < 2) return { groups: [], scanned: drafts.length, generated_at };

  // Cap the set; getAllDraftSignals returns newest-first, so take the head = the most-recent
  // drafts (the ones being actively reviewed) if the queue exceeds the ceiling (rare). The
  // scanned count reflects what was actually compared.
  const batch = drafts.length > DEDUPE_MAX ? drafts.slice(0, DEDUPE_MAX) : drafts;

  const list = batch
    .map((d, i) => `[${i}] ${d.title}${d.source_domain ? ` — ${d.source_domain}` : ''}\n    ${d.summary ?? ''}`)
    .join('\n\n');

  const out = await runStructured<{
    groups: { canonical_index: number; duplicate_indexes: number[]; reason: string }[];
  }>({
    system: DEDUPE_SYSTEM,
    user: `DRAFTS (group same-story restatements; reference items by their [index]):\n\n${list}`,
    toolName: 'submit_dedupe',
    toolDescription: 'Return the groups of draft entries that report the same development.',
    schema: DEDUPE_SCHEMA,
    maxTokens: 2000,
    effort: 'low',
    feature: 'draft_dedupe',
  });

  // Coerce indexes back to real drafts — never trust the model. Drop out-of-range/self
  // indexes, dedupe, and skip any group that ends up with no real duplicate. A draft can be a
  // duplicate in at most one group. Carry title + source so the review UI is self-contained.
  const memberAt = (i: number): DedupeMember | null =>
    Number.isInteger(i) && i >= 0 && i < batch.length
      ? { signal_id: batch[i].id, title: batch[i].title, source_domain: batch[i].source_domain }
      : null;
  const groups: DedupeGroup[] = [];
  const usedAsDup = new Set<string>();
  for (const g of out.groups ?? []) {
    const canonical = memberAt(g.canonical_index);
    if (!canonical) continue;
    const seen = new Set<string>([canonical.signal_id]);
    const duplicates: DedupeMember[] = [];
    for (const di of g.duplicate_indexes ?? []) {
      const mem = memberAt(di);
      if (!mem || seen.has(mem.signal_id) || usedAsDup.has(mem.signal_id)) continue;
      seen.add(mem.signal_id);
      usedAsDup.add(mem.signal_id);
      duplicates.push(mem);
    }
    if (!duplicates.length) continue;
    groups.push({ canonical, duplicates, reason: String(g.reason ?? '').slice(0, 300) });
  }
  return { groups, scanned: batch.length, generated_at };
}

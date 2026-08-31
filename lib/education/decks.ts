import type { CostDeck } from '@/lib/costs-deck';
import { buildAgenticHarnessesDeck } from './decks/agentic-harnesses';

// The slug-to-builder map for every guide that has a deck (GuideMeta.hasDeck
// === true in registry.ts). One entry per guide; adding a new guide deck
// means adding its builder file under lib/education/decks/ and a line here.
export const GUIDE_DECK_BUILDERS: Record<string, () => CostDeck> = {
  'agentic-harnesses': buildAgenticHarnessesDeck,
};

export function getGuideDeck(slug: string): (() => CostDeck) | undefined {
  return GUIDE_DECK_BUILDERS[slug];
}

export function guideDeckPdfFilename(slug: string): string {
  return `education-${slug}-deck.pdf`;
}

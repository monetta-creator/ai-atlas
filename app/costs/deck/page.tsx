import { requireAdminPage } from '@/lib/auth';
import { buildCostDeckData } from '@/lib/costs-deck';
import { renderDeckSlides } from '@/components/costs-deck/slides';
import DeckController from '@/components/costs-deck/DeckController';

// The live 16:9 cost deck: full-bleed, no site Header — the deck IS the
// page. force-dynamic (reads cookies + DB, admin-gated). buildCostDeckData
// only reads the cost log (no AI calls), so no maxDuration override is
// needed, matching /costs itself.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cost report · The AI Atlas' };

export default async function CostsDeckPage() {
  await requireAdminPage();
  const deck = await buildCostDeckData();
  return <DeckController slides={renderDeckSlides(deck)} />;
}

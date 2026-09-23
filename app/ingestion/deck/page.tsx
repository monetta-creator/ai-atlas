import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { publicParentFor } from '@/lib/nav';
import { buildStoryDeckData } from '@/lib/story-deck';
import { renderDeckSlides } from '@/components/costs-deck/slides';
import DeckController from '@/components/costs-deck/DeckController';

// The ingestion story deck: the answer to "what if we 1000x external signal
// ingestion?", on the same slide machinery as the cost deck. Full-bleed,
// admin-gated, live numbers.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'The 1000x question · The AI Atlas' };

export default async function IngestionDeckPage() {
  if (!(await isAdmin())) redirect(publicParentFor('/ingestion/deck').href);
  const deck = await buildStoryDeckData();
  return (
    <DeckController
      slides={renderDeckSlides(deck)}
      backHref="/ingestion"
      pdfHref="/ingestion/deck/pdf"
    />
  );
}

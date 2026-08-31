import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getGuide } from '@/lib/education/registry';
import { getGuideDeck } from '@/lib/education/decks';
import { renderDeckSlides } from '@/components/costs-deck/slides';
import DeckController from '@/components/costs-deck/DeckController';

// The live 16:9 guide deck: same full-bleed stage as /costs/deck, but public
// (guides are reader-facing, not an internal cost report), so there is no
// admin gate here. The deck content is fixed editorial copy (no DB, no AI
// call), so no maxDuration override is needed.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  return { title: guide ? `${guide.title} · The AI Atlas` : 'Education · The AI Atlas' };
}

export default async function EducationGuideDeckPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const builder = getGuideDeck(slug);
  if (!builder) notFound();
  const deck = builder();

  return (
    <DeckController
      slides={renderDeckSlides(deck)}
      backHref={`/education/${slug}`}
      pdfHref={`/education/${slug}/deck/pdf`}
    />
  );
}

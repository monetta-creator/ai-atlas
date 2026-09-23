// The Report Portal's fourth family: the 16:9 slide decks that live around
// the app (each with a live stage page and a react-pdf export). A static
// registry, because two of the three build their numbers from the DB at
// open time; the title-slide copy below mirrors each builder's own title
// slide so the portal card previews what the deck opens with. Pure: no db
// import, so it is safe for the client grid and the plain-Node test.

export type DeckAccess = 'admin' | 'public';

export interface DeckEntry {
  id: string;            // stable key, also the card id
  kicker: string;        // the deck's own title-slide kicker
  title: string;
  subtitle: string;
  href: string;          // the live stage
  pdfHref: string;       // the 16:9 PDF export
  access: DeckAccess;    // admin decks carry real spend / internal framing
  live: boolean;         // numbers rebuilt from the DB on every open
  slides: number | null; // fixed-copy decks know their length
}

export const DECKS: DeckEntry[] = [
  {
    id: 'deck-costs',
    kicker: 'Cost report',
    title: 'The running cost of a standing intelligence system',
    subtitle:
      'Continuous external-signal ingestion, a two-million-point metrics warehouse, daily automated collection, and AI enrichment: the whole stack, priced.',
    href: '/costs/deck',
    pdfHref: '/costs/deck/pdf',
    access: 'admin',
    live: true,
    slides: null,
  },
  {
    id: 'deck-ingestion',
    kicker: 'Thought experiment',
    title: 'What if we 1000x external signal ingestion?',
    subtitle:
      'The Atlas reads the outside world through one subsystem: continuous ingestion of news, filings, and regulatory data, structured on arrival. This is what scaling it costs, and what every surface above it gets when the dial turns.',
    href: '/ingestion/deck',
    pdfHref: '/ingestion/deck/pdf',
    access: 'admin',
    live: true,
    slides: null,
  },
  {
    id: 'deck-education-agentic-harnesses',
    kicker: 'Education · Field guide',
    title: 'The model is the engine. The harness is the car.',
    subtitle:
      'Every AI coding agent on the market is the same handful of frontier models wrapped in different scaffolding: what that scaffolding does, the three interfaces the market has built it into, and why the wrapper now matters more than the engine inside it.',
    href: '/education/agentic-harnesses/deck',
    pdfHref: '/education/agentic-harnesses/deck/pdf',
    access: 'public',
    live: false,
    slides: 10,
  },
];

export function visibleDecks(admin: boolean): DeckEntry[] {
  return DECKS.filter((d) => admin || d.access === 'public');
}

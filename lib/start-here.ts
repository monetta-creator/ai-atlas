// The "Where do I start?" dialog copy (2026-09-23). Pure, client-safe.
// Portal one-liners say what the reader GETS, not what the engine does.

export interface StartPortal {
  href: string;
  name: string;
  line: string;
  icon: string;   // key into PORTAL_ICONS
}

export const START_HERE = {
  kicker: 'Where do I start?',
  title: 'A map of the AI-economy debate.',
  what: [
    'The Atlas tracks the argument about AI and the economy as a map: open questions, the stances people take, the falsifiable claims those stances rest on, and the evidence for and against each claim.',
    'It orients rather than proves. On most days the honest reading is that nothing settled, and it says so.',
  ],
  why: [
    'Confident, contradictory claims arrive daily, and every source is selling something.',
    'Search returns documents, not positions; chatbots average the disagreement away.',
    'Nobody tracks what would actually settle the argument. The Atlas does: every claim carries a test.',
  ],
  different: [
    { axis: 'Returns', search: 'documents', chatbot: 'an answer', atlas: 'a position on a map' },
    { axis: 'Grounded in', search: 'whatever ranks', chatbot: 'training data', atlas: 'tracked evidence, cited' },
    { axis: 'When it is wrong', search: 'you find out later', chatbot: 'it apologizes', atlas: 'verification flags it to you' },
  ],
  portals: [
    { href: '/signals', name: 'Signal Board', line: 'Tracked AI developments, wired to the claims they touch.', icon: 'signals' },
    { href: '/blotter', name: 'News Blotter', line: 'A daily AI newspaper written from what the engines collected.', icon: 'blotter' },
    { href: '/map', name: 'Claims & Theses', line: 'The argument itself: questions, claims, evidence, and the theses tracked against them.', icon: 'claims' },
    { href: '/reports', name: 'Report Portal', line: 'Cited reports and 16:9 decks, downloadable as PDF.', icon: 'reports' },
    { href: '/datasets', name: 'Data Portal', line: 'Everything as CSV or JSON, with a documented schema.', icon: 'data' },
    { href: '/research', name: 'Research Portal', line: 'arXiv papers that bear on the debate, with findings extracted.', icon: 'research' },
    { href: '/scout', name: 'Startup Scout', line: 'Young AI companies tracked by vertical.', icon: 'scout' },
    { href: '/tooling', name: 'Tooling Monitor', line: 'The AI tool market, cataloged weekly, with build-or-buy briefs.', icon: 'tooling' },
    { href: '/education', name: 'Education', line: 'Hand-kept guides to how the machinery works, each with a 16:9 deck.', icon: 'education' },
  ] as StartPortal[],
  askLine: 'Ask anything the Atlas tracks. Answers cite the records they rest on, and each answer says how much of it the Atlas actually covers.',
  tourHref: '/about',
  tourLabel: 'Read the full tour',
};

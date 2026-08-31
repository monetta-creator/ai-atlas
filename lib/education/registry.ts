// The Education hub's guide catalog: pure data, no DB, no 'use client'. One
// row per published guide, consumed by the hub page (app/education/page.tsx)
// and the guide/deck routes (app/education/[slug]/*). The guide's actual body
// is a separate component under components/education/<slug>/ (a sibling
// build); this registry only carries the metadata needed to list and route
// to it.

export interface GuideMeta {
  slug: string;
  title: string;
  kicker: string; // mono eyebrow, e.g. 'FIELD GUIDE'
  summary: string; // one to two sentences for the hub card
  topics: string[]; // short chips, e.g. ['agents', 'tooling', 'MCP']
  addedOn: string; // '2026-08-30'
  hasDeck: boolean;
}

export const GUIDES: GuideMeta[] = [
  {
    slug: 'agentic-harnesses',
    title: 'Field guide to agentic harnesses',
    kicker: 'FIELD GUIDE',
    summary:
      'The model is the engine, the harness is the car: what agent scaffolding actually does, the three interfaces the market has built it into, and how to judge one.',
    topics: ['agents', 'harnesses', 'MCP', 'benchmarks'],
    addedOn: '2026-08-30',
    hasDeck: true,
  },
];

export function getGuide(slug: string): GuideMeta | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

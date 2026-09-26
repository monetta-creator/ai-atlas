// The daily edition's pack and narrative shapes (2026-09-23). The pack is
// guest-safe by construction: it carries headlines, urls, outlets, tiers,
// summaries and in-app hrefs, never review notes, raw text or admin columns.

import type { StoryCluster } from './cluster';
import type { DeskKey } from './desks';
import type { BuilderTag, CatalogRow } from './builders-core';
import type { PaperWeight } from './research-weight';

export interface EditionNumbers {
  itemsRead: number;        // scan + intel + pipeline candidates in the window
  outlets: number;          // distinct source domains
  signalsPublished: number;
  papersKept: number;       // papers the engine analyzed in the window (human-confirmed first)
  newTools: number;         // 0 outside a Monday
  clusters: number;
}

export interface EditionFrontItem {
  clusterId: string;
  headline: string;
  why: string;              // "Why it matters", one or two sentences
  numbers: string | null;   // "By the numbers", one sentence with figures from the pack, or null
  goDeeperHref: string;     // an in-app record or the lead item's url
  goDeeperLabel: string;
  coverage: string;         // coverageLine(cluster)
}

export interface EditionThing {
  headline: string;
  url: string;
  domain: string;
  tier: number | null;
  href: string | null;      // in-app record when one exists
  desk?: DeskKey;           // stamped at pack build since 2026-09-26; older rows group from the headline
}

export interface EditionPaper {
  id: string;
  title: string;
  href: string;             // /research/<id>
  whoCares: string | null;  // the audience note (the dek before 2026-09-26; now the fallback)
  headlineClaim: string | null;
  finding?: string | null;  // headline_claim, deDashed: the dek since 2026-09-26
  weight?: PaperWeight;     // the quiet importance marks (research-weight.ts); absent on older rows
}

// What builders are reading (2026-09-26): Hacker News front-page stories a
// cheap model judged useful for an AI builders pod inside a large regulated
// company, each with a one-line why, plus the tooling monitor's vendor
// release events in the window. Guest-safe: titles, urls, counts, tags.
export interface EditionBuilderRead {
  title: string;
  url: string | null;
  hnUrl: string;
  points: number;
  comments: number;
  tag: BuilderTag;
  line: string | null;      // the one-line why, ≤140 chars, null on the no-model fallback
  showHn: boolean;
  repo: boolean;            // github / gitlab / hugging face host
  debate: boolean;          // comments outrun points
  catalogHref: string | null; // /tooling/<slug> when the story names a cataloged product
}

export interface EditionRelease {
  productName: string;
  productHref: string;      // /tooling/<slug>
  title: string;
  url: string | null;
  kind: string;             // launch | feature | pricing | changelog
  date: string;             // YYYY-MM-DD
}

export interface EditionBuilders {
  reads: EditionBuilderRead[];
  releases: EditionRelease[];
  judged: boolean;          // false = the no-model fallback (budget spent or the leg failed)
  candidates?: EditionHnItem[]; // the wide HN candidate list the judge saw; pack-internal, views ignore it
  products?: CatalogRow[];      // the catalog matcher rows (public columns); pack-internal, views ignore it
}

export interface EditionTool {
  slug: string;
  name: string;
  vendor: string | null;
  oneLiner: string | null;
  href: string;             // /tooling/<slug>
}

export interface EditionBlindSpot {
  headline: string;
  url: string | null;
}

export interface EditionSourceRow {
  domain: string;
  tier: number | null;
  count: number;
}

// "What builders are reading": Hacker News front-page stories that name AI,
// fetched at edition time from the free Algolia API (no cron, no table).
export interface EditionHnItem {
  title: string;
  url: string | null;       // the story's own link (null for Ask HN etc.)
  hnUrl: string;            // the comments page
  points: number;
  comments: number;
}

// The market strip: an AI basket priced at edition time from a keyless
// quote endpoint; the whole strip is omitted when the source fails.
export interface EditionMarketRow {
  symbol: string;
  label: string;
  price: number;
  changePct: number;        // day change, percent
  spark: number[];          // recent daily closes, oldest first (up to 22)
}

export interface EditionPack {
  day: string;              // YYYY-MM-DD (the edition's date)
  windowFrom: string;       // ISO timestamps of the intake window
  windowTo: string;
  issueNumber: number;      // count of editions so far + 1
  numbers: EditionNumbers;
  clusters: StoryCluster[]; // ranked; the front is drawn from the top
  thingsHappen: EditionThing[];      // AI stories only (isAiStory), desk-stamped
  industry?: EditionThing[];         // the strongest non-AI financial-services stories (2026-09-26)
  // Written until 2026-09-26, never rendered since; kept optional so an older
  // stored edition still type-checks. No writer fills this any more.
  companies?: { companySlug: string; companyName: string; facts: { fact: string; valueText: string | null; url: string | null }[] }[];
  papers: EditionPaper[];
  tools: EditionTool[];
  blindSpots: EditionBlindSpot[];
  sources: EditionSourceRow[];
  claimsTouched: { code: string; statement: string; href: string; signalHrefs: string[] }[];
  hn?: EditionHnItem[];
  builders?: EditionBuilders;        // 2026-09-26; absent on older rows, the view falls back to hn
  markets?: { asOf: string; rows: EditionMarketRow[] } | null;
  priorFront?: { day: string; headlines: string[] }[]; // the last 2 published editions' front headlines, for the repeat penalty
  generatedAt: string;
}

export interface EditionNarrative {
  front: EditionFrontItem[];
  column: { title: string; html: string };
  citedTags: string[];
  dropped: string[];
  model: string | null;
}

// A saved edition row (generated_reports, kind 'edition'), the shape
// lib/data/editions.ts reads back. Mirrors SavedSheet's fields but with the
// edition's own pack/narrative shapes rather than AnySheetPack/SheetNarrative.
export interface SavedEdition {
  id: string;
  day: string;              // 'YYYY-MM-DD' (generated_reports.scope_to)
  pack: EditionPack;
  narrative: EditionNarrative;
  is_published: boolean;
  generated_at: string;     // ISO
}

// The row shape for the /blotter archive list and the Report Portal's
// editions chip: just enough to render a link, never the full pack.
export interface EditionListRow {
  id: string;
  day: string;               // 'YYYY-MM-DD'
  headline: string | null;   // narrative.front[0].headline
  numbers: EditionNumbers | null;
  is_published: boolean;
}

export interface EditionPrefs {
  enabled: boolean;
  model: string;
  front_items: number;
  builders_steering: string | null; // 0067; null = DEFAULT_BUILDERS_STEERING in lib/edition/builders.ts
}

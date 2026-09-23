// The company intel deck (migrations 0061/0062): what the Intel Desk stored
// for every tracked company in one press-to-press window, plus a cited
// one-line read per company and a cross-company front. Types only (pure).

export type IntelDeckTier = 'card_issuer' | 'consumer_bank' | 'fintech' | 'tech_platform' | 'wildcard';

export interface IntelDeckItem {
  id: string;
  headline: string;
  url: string;
  domain: string | null;
  sourceTier: number | null;
  publishedDate: string | null;   // YYYY-MM-DD
  significance: number | null;    // 0..1
  docType: string | null;         // news | press | filing | transcript | report
  summary: string | null;
}

export interface IntelDeckFact {
  id: string;
  dimension: string;
  fact: string;
  valueText: string | null;
  asOf: string | null;
  url: string | null;             // the provenance item's url
}

export interface IntelDeckFiling {
  id: string;
  headline: string;
  url: string;
  publishedDate: string | null;
}

export interface IntelDeckMetric {
  code: string;
  label: string;
  period: string;
  value: number;
  unit: string | null;
  prevValue: number | null;
  prevPeriod: string | null;
  deltaPct: number | null;
  source: string;
}

export interface IntelDeckCompany {
  slug: string;
  name: string;
  tier: IntelDeckTier;
  domain: string | null;
  ticker: string | null;
  logoDataUri: string | null;     // baked at pack-build time for the PDF; null = monogram
  items: IntelDeckItem[];         // up to 6, by significance then recency
  facts: IntelDeckFact[];         // up to 6
  filings: IntelDeckFiling[];     // up to 4
  metrics: IntelDeckMetric[];     // up to 4, only rows fetched in the window
  score: number;                  // deterministic: Σ significance + 0.5/fact + 1.0/filing + 1.5/metric
}

export interface IntelDeckQuiet { slug: string; name: string; tier: IntelDeckTier; domain: string | null }

export interface IntelDeckMover { slug: string; name: string; score: number; headline: string | null }

export interface IntelDeckNumbers {
  companies: number;   // companies with anything in the window
  quiet: number;
  items: number;
  facts: number;
  filings: number;
  metrics: number;
  outlets: number;
}

export interface IntelDeckPack {
  day: string;
  windowFrom: string;
  windowTo: string;
  issueNumber: number;
  numbers: IntelDeckNumbers;
  // Projected by listGeneratedReports (pack->'stats') for the Report Portal card.
  stats: { companies: number; movers: number; quiet: number; items: number; facts: number };
  companies: IntelDeckCompany[];  // active, tier <> 'self', with something in the window; by score desc
  quiet: IntelDeckQuiet[];
  movers: IntelDeckMover[];       // top 3 by score
  generatedAt: string;
}

export interface IntelDeckSentence { slug: string; html: string }

export interface IntelDeckNarrative {
  sentences: IntelDeckSentence[]; // one per company at most, citation-gated
  frontHtml: string | null;       // the cross-company front, citation-gated
  model: string | null;
  dropped: string[];
}

export interface SavedIntelDeck {
  id: string;
  scope_to: string;               // the day
  is_published: boolean;
  generated_at: string;
  pack: IntelDeckPack;
  narrative: IntelDeckNarrative;
}

import { PAGE_INFO_A } from './page-info-a';
import { PAGE_INFO_B } from './page-info-b';
import { PAGE_INFO_C } from './page-info-c';
// Page explainers behind the round "i" at the top of every page (2026-09-23).
// One entry per route pattern, longest prefix wins. `summary` is the sentence
// that used to be the page's lede; `sections` are two to four short heads with
// a paragraph each, in the house voice. No em dashes.

export interface PageInfoSection {
  heading: string;
  body: string;
}

export interface PageInfoContent {
  title: string;
  summary: string;
  sections: PageInfoSection[];
}

const CORE: Record<string, PageInfoContent> = {
  '/signals/drafts': {
    title: 'How the draft queue works',
    summary:
      'Your unpublished working queue. Publishing a draft adds its findings to the Argument Map as evidence. Archiving sets a draft aside and keeps everything: the row, its source link, and its candidate all stay in the database.',
    sections: [
      {
        heading: 'Where drafts come from',
        body: 'The discovery pipeline runs every weekday and drafts a signal for each candidate that passes triage: a title, a summary, a significance, the audience lenses, and one or more claim touches with a direction and a reason. Nothing here is public until you publish it.',
      },
      {
        heading: 'Cut before reading',
        body: 'Three judgment-free moves archive drafts you would never publish: those touching no claim, the low-significance ones, and anything older than 45 days. Archive is reversible and deletes nothing.',
      },
      {
        heading: 'The review sprint',
        body: 'One draft at a time, highest significance first. P publishes, A archives, S skips to the next and parks the draft at the end, the left arrow steps back. Each card shows the claim touches with the claim statement, the direction, and the model\'s reason, so the decision is made on the evidence, not the headline.',
      },
      {
        heading: 'The promotion policy',
        body: 'High-significance pipeline drafts with at least one claim touch publish on their own after the veto window unless you archive them first. Only drafts created after the policy started are eligible, so a backlog never bulk-publishes behind your back.',
      },
    ],
  },
  '/datasets': {
    title: 'How the Data Portal works',
    summary:
      'The Atlas as data: every published signal, claim, evidence row, concept, and report, downloadable as CSV or JSON with a documented schema. Built for analysts: filter and group in the browser, pull a file into Sheets or a notebook, or ask in plain language and get a cited answer with the right dataset attached.',
    sections: [
      {
        heading: 'What is here',
        body: 'Each dataset page shows its schema, a methodology note, a preview you can filter and group in the browser, and download links. Public datasets are cached at the edge; the key-gated ones (full article text, the firewall exports) need an access key.',
      },
      {
        heading: 'Guest safety',
        body: 'Every column is allow-listed in code. Confidence numbers, review notes, and anything from the personal layer never ship in a public dataset; a test fails the build if a banned key appears.',
      },
      {
        heading: 'Ask instead of download',
        body: 'The Ask button opens a chat grounded in these same records. Answers cite the signal, claim, or paper they rest on, and the peek panel opens the record without leaving the page.',
      },
    ],
  },
  '/tooling': {
    title: 'How the Tooling Monitor works',
    summary:
      'A weekly scan of the AI tool market for a transformation team at a regulated financial-services company. It answers four questions: what is on the market, how the market dimensionalizes, who just entered, and whether to build or buy.',
    sections: [
      {
        heading: 'How a product gets here',
        body: 'Every Monday the engine sweeps news search, Hacker News, GitHub, and vendor feeds for each category, extracts distinct products, reads each homepage, and fills a structured fact sheet. A rubric written for this team scores fit from 0 to 100. At or above the catalog threshold a product is cataloged; under it, or when the homepage never fetched, it is held for human review. Human decisions are sticky.',
      },
      {
        heading: 'Reading a card',
        body: 'Name and vendor, a one-line description, then maturity, deployment model, pricing model, and first seen, the date the scanner found it (not the founding date). The tags are features named in the product\'s own material. Team keyholders also see the fit band, the agent\'s rubric score, which is recommend-only.',
      },
      {
        heading: 'Who sees what',
        body: 'Guests see the catalog and published reports. Team keyholders also see held products, the agent read, and deep dives, and can add a product or generate a report. The console is admin only.',
      },
      {
        heading: 'Reports',
        body: 'Four kinds, all grounded in the catalog and cited back to it: the weekly new entrants (auto-published every Monday), a category landscape, a build-or-buy brief, and a feature sheet. All downloadable as branded PDFs from the Report Portal.',
      },
    ],
  },
};

// Slices written per portal group live in page-info-a.ts / page-info-b.ts / page-info-c.ts;
// CORE holds the first four (the golden examples). Later keys win on collision.
export const PAGE_INFO: Record<string, PageInfoContent> = { ...PAGE_INFO_A, ...PAGE_INFO_B, ...PAGE_INFO_C, ...CORE };

export function pageInfoFor(pathname: string): PageInfoContent | null {
  let best: string | null = null;
  for (const key of Object.keys(PAGE_INFO)) {
    if ((pathname === key || pathname.startsWith(`${key}/`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? PAGE_INFO[best] : null;
}

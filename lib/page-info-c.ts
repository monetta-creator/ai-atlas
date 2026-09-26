import type { PageInfoContent } from './page-info';

// Page explainer slice C (see lib/page-info.ts for the contract and voice):
// the daily edition (/blotter, /blotter/[day], /blotter/archive, /blotter/desk).
export const PAGE_INFO_C: Record<string, PageInfoContent> = {
  '/blotter': {
    title: 'How the daily edition works',
    summary:
      'The AI Atlas written up as a paper: the day\'s most significant developments, a column that ' +
      'connects them to the claims on the Argument Map, and everything else worth a line. It writes ' +
      'itself on weekday afternoons from what the engines already tracked.',
    sections: [
      {
        heading: 'Where the items come from',
        body: 'Every item on the page already exists as a record: the External Scan and Intel Desk sweeps, the discovery pipeline\'s approved candidates and published signals, research papers kept that day, and new tools on Mondays. Nothing is written from scratch for the edition; it clusters and ranks what the day\'s engines already stored.',
      },
      {
        heading: 'The front and the column',
        body: 'A cheap model drafts the five to seven front items and a short column in the style of a market letter, connecting two or three of the day\'s stories to the claims they touch. Every link it writes is checked against the day\'s own records before the page renders: a link the model invents, rather than one that resolves to a stored item, never appears.',
      },
      {
        heading: 'Coverage, not just headlines',
        body: 'Each story\'s coverage line counts how many distinct outlets reported it and what tier they are, the way a fact-checking service would. Blind spots lists developments the desk flagged as significant but never got picked up on, so the gaps are visible instead of hidden.',
      },
      {
        heading: 'Publishing',
        body: 'The edition auto-publishes: once it runs, its day is public at /blotter/<day> with no login needed, so it can be shared. The map-health dashboard that used to live at this address moved to the admin-only Desk.',
      },
    ],
  },
  '/blotter/[day]': {
    title: 'Reading an archived edition',
    summary: 'One day\'s edition, exactly as it ran. Use the arrows to step to the day before or after.',
    sections: [
      {
        heading: 'A frozen record',
        body: 'An archived edition never changes after it runs: the items, the column, and every link on the page are fixed to what the engines had stored that day.',
      },
      {
        heading: 'Reading the research marks',
        body: 'Each paper carries up to three dots: a human confirmed it, it bears on a standing position or thread, and the model-rated rigor is high. The line under the title is the paper\'s own finding in one sentence; the small caps line spells the marks out, and CONTRADICTS flags a paper that pushes back on a position.',
      },
      {
        heading: 'What builders are reading',
        body: 'Hacker News front-page stories a model judged useful for people building with AI inside a large regulated company, each with a one-line why and a tag, beside the vendor releases the tooling monitor caught in the window.',
      },
      {
        heading: 'Two downloads',
        body: 'Newspaper PDF is the edition as a two or three page paper, US Letter, every link live. Deck is the same edition as 16:9 slides.',
      },
    ],
  },
  '/blotter/archive': {
    title: 'The edition archive',
    summary: 'Every past edition, grouped by month, newest first.',
    sections: [
      {
        heading: 'What is listed',
        body: 'Guests see every published edition. Admins also see days that ran but were never published, useful for checking a run before it goes out.',
      },
    ],
  },
  '/blotter/desk': {
    title: 'What the Desk shows',
    summary:
      'The map-health dashboard that used to be the blotter, before the daily edition took that address. ' +
      'It tracks the health of the Argument Map and the discovery pipeline, not the news, so it stays admin-only.',
    sections: [
      {
        heading: 'Map health',
        body: 'The claims ledger, the signal wire, and (out of preview) the recent confidence moves: the same personal-layer view the maintainer used to open first.',
      },
      {
        heading: 'The pipeline\'s own business',
        body: 'Discovery-pipeline analytics and the full candidate archive live here, the working detail behind the signals the public edition and Signal Board surface.',
      },
    ],
  },
  '/savant/desk': {
    title: 'Savant desk',
    summary:
      'Savant is the Atlas\'s autonomous weekly research report. This desk shows the week\'s notebook ' +
      '(connections, anomalies, misses, the Monday plan, daily notes), the hypotheses ledger, and the prefs.',
    sections: [
      {
        heading: 'How the week runs',
        body: 'A weekday pass writes to the notebook at 17:15 UTC: it plans a lead for Monday, and every day adds notes, connections, echoes, anomalies, and misses as it finds them. Friday\'s issue reads the week\'s notebook and closes or moves each open hypothesis.',
      },
    ],
  },
};

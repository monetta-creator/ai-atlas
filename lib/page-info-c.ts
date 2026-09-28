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
  // '/blotter/desk' retired 2026-09-26: the map-health/pipeline dashboard is
  // gone and the route now redirects to '/savant/desk', which renders no
  // PageTop of its own (it never reaches a page body), so no entry is needed.
  '/portals': {
    title: 'The portals',
    summary:
      'Every public surface of the Atlas in one place: what each portal is for and the pages inside it. ' +
      'The left rail lists the same portals under one entry; a portal\'s own pages appear as tabs at the top of that portal.',
    sections: [
      {
        heading: 'How to read this page',
        body: 'Each card is one portal: its name, a sentence on what it does, and its pages. Pages marked for access-key holders or the admin show only when you can open them.',
      },
    ],
  },
  '/savant': {
    title: 'How Savant works',
    summary:
      'Savant is the Atlas\'s autonomous weekly research report: one issue every Friday, written for people ' +
      'doing AI transformation inside large regulated financial-services companies and read by their ' +
      'executives. It is its own imprint under The AI Atlas, and it needs an access key.',
    sections: [
      {
        heading: 'Public data only',
        body: 'Savant reads only what the Atlas\'s engines collect from public sources: news and filings, extracted facts, research papers, the tooling monitor, and published signals and their evidence. It never reads admin notes or free text, and every figure and every link in an issue traces to one of those records.',
      },
      {
        heading: 'Who can read it',
        body: 'An access key or the admin password. The public page shows an issue\'s title and table of contents only, because the peer and market watch section names the reader organization and its industry peers by tier.',
      },
      {
        heading: 'The editorial rules',
        body: 'One new falsifiable hypothesis a week, carried forward and revisited every issue after. A model writes each department over a frozen weekly notebook; an editor persona reviews the draft against a fixed checklist before it publishes. Nothing about the reader organization may lean on anything but a cited public record.',
      },
    ],
  },
  '/savant/[week]': {
    title: 'Reading an archived issue',
    summary: 'One week\'s issue, exactly as it published. Use the archive to browse every past week.',
    sections: [
      {
        heading: 'A frozen record',
        body: 'An issue never changes after it publishes: the notebook it drew on, the hypotheses it moved, and every link on the page are fixed to what the engines had stored that week.',
      },
      {
        heading: 'Reading the hypotheses',
        body: 'Each week either poses one new hypothesis or updates the standing ones: strengthened, weakened, unchanged, or closed with a verdict. Appendix A shows the notebook entries the week\'s reading rests on.',
      },
    ],
  },
  '/savant/archive': {
    title: 'The Savant archive',
    summary: 'Every past issue, newest first.',
    sections: [
      {
        heading: 'What is listed',
        body: 'Access-key holders and the admin see every issue with its title and issue number. Anyone else sees the same list\'s table of contents only, with a link to request a key.',
      },
    ],
  },
  '/savant/record': {
    title: 'The company record',
    summary:
      'Everything public about the reader organization since ChatGPT: filings, press releases, news, research, ' +
      'patents and the regulatory record, with the AI timeline and the cited profile Savant reads.',
    sections: [
      {
        heading: 'Where it comes from',
        body: 'A one-time backfill of public sources, keyed to each document\'s own publish date, never the maintainer\'s notes or anything not already public.',
      },
      {
        heading: 'Who can read it',
        body: 'An access key or the admin password, the same gate as the rest of Savant.',
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
  '/field-reports': {
    title: 'How Field Report works',
    summary:
      'Research reports the Atlas writes on request: it drafts a plan you edit, researches the Atlas records ' +
      'first, then the web for gaps, and labels every paragraph by where it came from.',
    sections: [
      {
        heading: 'Starting one',
        body: 'Field Report is a mode of the Ask workspace: ask a question, pick Brief (a few minutes, under a dollar) or Full (longer, an editor review and figures), edit the plan the Atlas proposes, then run it. The run happens in the background, so closing the tab does not lose it.',
      },
      {
        heading: 'Sourcing and labeling',
        body: 'Every paragraph is marked Atlas, Web, Mixed, or the Atlas\'s own analysis, both inline and in the provenance bar at the top of the report, so a reader always knows where a claim came from.',
      },
      {
        heading: 'Who can read one',
        body: 'A keyholder sees their own reports and any the admin has published; admin sees every run. A report is never visible to a guest, published or not.',
      },
    ],
  },
  '/field-reports/desk': {
    title: 'Field Report desk',
    summary:
      'The admin console for Field Report: the enabled switch, the model each size uses per role, effort, web ' +
      'searches, both daily caps, a live cost estimate, and recent runs.',
    sections: [
      {
        heading: 'Models',
        body: 'Research, writer and editor call the Anthropic Messages API directly for their tool loop and adaptive thinking, so those three pickers offer Anthropic models only. Figures goes through the routed structured call and can pick any catalog model.',
      },
      {
        heading: 'Money',
        body: 'A keyholder is capped per key per day; all keyholders together share a second, higher cap. Admin runs are uncapped. Both are read from today\'s ai_cost_log rows for Field Report\'s features.',
      },
    ],
  },
  '/field-reports/[id]': {
    title: 'Reading a Field Report',
    summary: 'A cited research report: the plan\'s sub-questions as the contents, a provenance chip on every paragraph, and two appendices covering how it was researched and what it cites.',
    sections: [
      {
        heading: 'Provenance',
        body: 'Atlas means the paragraph rests on a tracked record; Web means a public source the run found while filling a gap; Mixed draws on both; Analysis is the Atlas\'s own reasoning, never presented as sourced.',
      },
      {
        heading: 'Appendices',
        body: 'Appendix A lists every research round and query the run made. Appendix B lists every source the report actually cites, in reading order.',
      },
    ],
  },
};

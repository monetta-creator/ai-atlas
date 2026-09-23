import type { PageInfoContent } from './page-info';

// Page explainer slice B (see lib/page-info.ts for the contract and voice).
// Covers: Report Portal, Research Portal, Startup Scout, Tooling reports and
// console, Education, the About section, Costs, Pipeline, Scan, Intel,
// Ingestion, Tickets, Agent, and the dataset detail page.
export const PAGE_INFO_B: Record<string, PageInfoContent> = {
  '/reports': {
    title: 'How the Report Portal works',
    summary:
      'Grounded reports from the Atlas corpus at claim, lens, thesis, and whole-Atlas granularity: cited, synthesized, and downloadable as branded PDFs.',
    sections: [
      {
        heading: 'Five report families',
        body: 'Generated sheets cover one claim, one lens, or the whole Atlas, drafted on demand from the console below. Period reports compile a date range across the Signal Board. Thesis reports track one investment thesis against the map. The Daily Edition, the weekly tooling entrants report, and the Friday research roundup are the three kinds that auto-publish; period reports are public on save; everything else is a human publish.',
      },
      {
        heading: 'The citation gate',
        body: 'Every narrative is drafted over a frozen data pack computed from the database first. Before it ships, every citation in it is checked against that pack: one the pack cannot vouch for is stripped and the drop recorded. The check runs again at save and at render, so an edited or stale report cannot smuggle a citation back in.',
      },
      {
        heading: 'Publishing is the gate',
        body: 'A generated sheet is a draft until an admin publishes it, except the three auto-publishing kinds (the Daily Edition, the tooling entrants report, the research roundup), which go public when they run. Guests see published reports only; admins and, for the four tooling report kinds, portal keyholders can read a draft. Each row expands to a preview (a text abstract plus deterministic stats) before committing to the full read.',
      },
    ],
  },
  '/reports/period': {
    title: 'How the period generator works',
    summary:
      'Compile a period intelligence report from the Signal Board: pick a date range and the lenses to cover, generate the narrative, edit it, and save or export to PDF.',
    sections: [
      {
        heading: 'The pipeline',
        body: 'buildReportData assembles the data half first (evidence counts, signal stats, touched claims) for the chosen range and lenses. One model call narrates each lens, then a synthesis pass ties them together in an analyst voice. Nothing is saved until you save it.',
      },
      {
        heading: 'No publish gate',
        body: 'Unlike a generated sheet, a saved period report is public the moment it is saved: there is no separate publish step. Review the narrative in the editor before saving if it should not go out yet.',
      },
    ],
  },
  '/research': {
    title: 'How the Research Portal works',
    summary:
      "What the recent AI literature says, and what it changes: living syntheses by question, a tracked watchlist, and every paper's finding one click away.",
    sections: [
      {
        heading: 'The daily engine',
        body: 'A day-keyed engine pulls and triages arXiv papers on four weekday cron windows, scores the pending queue with a steering-aware agent, and auto-hydrates and extracts the findings it is most confident about. The triage charter defines keep-worthiness by the argument graph, not by taste, and is regression-tested against a hand-labeled gold set.',
      },
      {
        heading: 'Threads are the spine',
        body: 'A thread is a living synthesis of what the literature says on one frontier question, revised as tracked papers land. Papers group under a thread by relation: supports, contradicts, complicates, or context. The synthesis is public; the revision trail and placement rationales stay admin.',
      },
      {
        heading: 'The three review decisions',
        body: 'Track joins the watchlist and requires a one-line why. Note files a paper as worth remembering with no active attention. Dismiss leaves the queue but keeps the row, so rising citations can resurface it later. Nothing here writes evidence: promoting a paper to a signal, and publishing it, is the only road onto the Argument Map.',
      },
    ],
  },
  '/research/console': {
    title: 'How the research console works',
    summary:
      'The working side of the Research Portal: the daily engine, the review queue, manual adds, thread tools, citation self-correction, and run history.',
    sections: [
      {
        heading: 'Engine and models',
        body: "Today's run status, the crons on/off toggle, and the model pickers for triage and analysis. No frontier model runs anywhere in the loop; every step routes through a cheap model chosen by measurement.",
      },
      {
        heading: 'Queue and agent',
        body: 'The review queue sorts track-candidates first using the agent’s recommendation and confidence. The finding-coverage strip flags papers with no structured extraction yet and can batch-analyze the reviewed shelf.',
      },
      {
        heading: 'Health and exports',
        body: 'Run health over the trailing 30 days, a model A/B table comparing triage and analysis models, and the research-export and research-papers datasets with their importer handoff doc.',
      },
    ],
  },
  '/scout': {
    title: 'How Startup Scout works',
    summary:
      'Young AI companies tracked as acquisition candidates, organized by vertical. Each profile carries what the company does, the AI tech itself, and a running event timeline.',
    sections: [
      {
        heading: 'The funnel',
        body: 'Discovery runs by vertical against a curated query set, screening for young companies (founded within about six years, pre-seed through Series B). A scoring agent rates each candidate pursue, watch, or pass against an editable rubric before a human review decision tracks or dismisses it.',
      },
      {
        heading: 'What guests see',
        body: 'Only tracked companies are public; a company still in the queue is not shown, since a public "pursue" chip on a named startup would disclose acquisition intent. Team keyholders additionally see queued profiles, the agent read, and can add a target or run research on any visible company.',
      },
      {
        heading: 'Research on a profile',
        body: 'A one-off steering note, a web intelligence sweep, and document upload (browser-extracted text, never the file) all merge into the company’s dossier monotonically: later writers never clobber earlier ones. Facts fill only what is null; a human edit always wins.',
      },
    ],
  },
  '/scout/console': {
    title: 'How the Scout console works',
    summary:
      'The working side of Startup Scout: review discovered companies, add candidates by hand, tend the verticals.',
    sections: [
      {
        heading: 'Run and agent',
        body: 'One discovery batch per vertical per run, deduped globally by domain and name, never re-queuing a dismissed company. The scoring agent runs in 10-company chunks against the editable rubric in prefs.',
      },
      {
        heading: 'Queue, adds, verticals',
        body: 'The review queue sorts pursue-first by the agent’s confidence. Companies can be added manually here or land through the public research panel’s add-target action. Verticals are registry rows carrying their own discovery query templates.',
      },
    ],
  },
  '/tooling/reports': {
    title: 'How tooling reports work',
    summary:
      'Generate a category landscape, a build-or-buy brief, the week’s new entrants, or a feature-steal sheet from the AI Tooling Monitor catalog.',
    sections: [
      {
        heading: 'Four kinds',
        body: 'A category landscape and a build-or-buy brief are generated on demand from the catalog. The weekly new-entrants report runs every Monday and auto-publishes. A feature sheet lists who ships what, for stealing ideas. All four are grounded in the catalog and citation-gated.',
      },
      {
        heading: 'Who can generate one',
        body: 'Guests see the shelf of published tooling reports only. Generating a report is a live model call, so it sits behind the team portal key or the admin session; a visitor with neither sees an inline unlock instead of a login bounce.',
      },
    ],
  },
  '/tooling/console': {
    title: 'How the Tooling console works',
    summary:
      "The AI Tooling Monitor's operating surface: weekly runs, the big one-time pull, prefs, curation, datasets, and history.",
    sections: [
      {
        heading: 'The weekly engine',
        body: 'Every Monday: discover per category, hydrate, enrich, score against the rubric, then finish, sweep vendor feeds for events, deep-dive high-fit entrants, and publish the entrants report. A separate one-time pull enumerates leaders and emerging players per category on demand.',
      },
      {
        heading: 'Curation and datasets',
        body: 'Scored products land cataloged or parked by threshold; a human decision is sticky and is never overwritten by a later run. Three key-gated datasets (products, events, features) and the public catalog dataset ship with a generated importer handoff doc.',
      },
    ],
  },
  '/education': {
    title: 'How the Education hub works',
    summary:
      'Guides worth keeping: things learned along the way, written up properly and given a permanent home. Not a feed, a shelf.',
    sections: [
      {
        heading: 'What a guide is',
        body: 'Each guide is hand-written and checked into the codebase as a component, not stored in the database or uploaded through a form. A guide can ship an optional 16:9 deck version of the same material.',
      },
    ],
  },
  '/about': {
    title: 'How the About section works',
    summary: 'A structured map for staying oriented in the AI economy debate.',
    sections: [
      {
        heading: 'The map’s shape',
        body: 'A question holds two to four stances, each stance rests on claims, and every claim carries a test: what would have to be true to stop believing it. Evidence attaches to claims as supporting or contradicting. A private layer holds the author’s confidence and reasons; the public view is the same map with that layer stripped.',
      },
      {
        heading: 'What the rest of this section covers',
        body: 'Guardrails explains the schema rules that enforce falsifiability. Glossary defines every term. Limitations is an honest account of what the tool does not do. Signal ingestion and Why bespoke explain the intake and the case for a purpose-built system over a general chatbot or a commercial platform. Data handling says where the data comes from, which outside services process it, what is stored, and who can see what.',
      },
    ],
  },
  '/about/guardrails': {
    title: 'About: Guardrails',
    summary: 'The schema rules that enforce falsifiability, and the anti-patterns they block.',
    sections: [
      {
        heading: 'What is enforced',
        body: 'A claim must carry a test unless it is tagged a frame. Claims belong to exactly one domain, so a finding in one cannot quietly move another; a bridge-claim makes a genuine cross-domain link explicit and testable on its own. Evidence is recorded as supporting or contradicting, both counted equally, and a one-sided claim is flagged, not resolved.',
      },
      {
        heading: 'The human gate',
        body: 'The model proposes and never commits: it never sets a reliability prior, never writes evidence, never moves a confidence. Every generated narrative passes a citation gate at generation, save, and render, so a link the underlying data cannot vouch for is always stripped.',
      },
    ],
  },
  '/about/glossary': {
    title: 'About: Glossary',
    summary: 'Every term defined: question, stance, claim, test, frame, bridge-claim, and the rest.',
    sections: [
      {
        heading: 'How to use it',
        body: 'One definition per term, in the order the map builds: question, stance, claim, test, frame, domain, bridge-claim, evidence, source, confidence, rationale, and on through the Signal Board, research, and Scout vocabulary.',
      },
    ],
  },
  '/about/limitations': {
    title: 'About: Limitations',
    summary: 'What the tool does not do, what is not built yet, and the ways it can be wrong.',
    sections: [
      {
        heading: 'One person, one lens',
        body: 'This is one author’s map: one lens in the deep argument map, one person’s confidence judgments, updated only when the author runs a pipeline or adds something by hand. Nothing polls or auto-updates the map itself.',
      },
      {
        heading: 'Where it can still be wrong',
        body: 'Confidence levels can carry the author’s bias, evidence can stay one-sided if the looking stops, and claims can go stale between updates. The guardrails reduce the obvious failure modes; they do not remove them.',
      },
    ],
  },
  '/about/ingestion': {
    title: 'About: Signal ingestion',
    summary:
      'The Atlas runs a continuous, large-scale intake of external signal: news, filings, and regulatory data, collected daily, structured by models under strict rules, and packaged to travel.',
    sections: [
      {
        heading: 'The standing intake',
        body: 'Every weekday, before anyone opens the site, the system sweeps press feeds, targeted news search, and primary regulatory sources. Every item is fetched in full text, deduplicated, and stored with its provenance.',
      },
      {
        heading: 'Structure, metrics, exports',
        body: 'A model reads each item under strict controlled vocabularies: a tag, a link, or a fact outside the allow-list is dropped, not stored. A separate metrics warehouse carries roughly two million data points straight from public regulatory sources, untouched by any model. Everything ships as versioned datasets with a formal schema built to travel.',
      },
    ],
  },
  '/about/data-handling': {
    title: 'About: Data handling',
    summary:
      'Where the data comes from, which outside services process it, what is stored and for how long, what counts as personal data here, and who can see what.',
    sections: [
      {
        heading: 'A personal project, public by URL',
        body: 'The site runs on the maintainer’s own hosting accounts and is not an employer system or any organization’s official view. Every engine reads public sources only, and the text it collects is sent to outside model, search, and fetch providers whose own retention terms apply.',
      },
      {
        heading: 'Kept indefinitely, three access tiers',
        body: 'Full article text, filings, paper text, extracted facts, and report packs are stored with no retention limit or deletion job; archiving hides, it does not delete. A guest sees the public layer, an access key unlocks Ask and the key-gated datasets, and the admin sees the personal layer and the consoles. Do not enter confidential information into Ask, uploads, or forms.',
      },
    ],
  },
  '/about/why-bespoke': {
    title: 'About: Why bespoke',
    summary:
      'What this does that a general chatbot cannot, where it stands against commercial enterprise research platforms, and why every layer of it is changeable.',
    sections: [
      {
        heading: 'Against a chatbot',
        body: 'A general chatbot starts from zero every conversation. This system’s collection is continuous and compounding: each day’s sweep lands in a permanent, deduplicated record with provenance, and a question today is answered from everything gathered so far, cited back to the original documents.',
      },
      {
        heading: 'Against commercial platforms',
        body: 'Commercial research platforms are one-size-fits-all by construction. Every layer here (what to track, what to ask, what to tag, which models, how much to spend, what ships) is an editable row or a deploy, not a vendor request, and exports carry standard identifiers so licensed data can still be joined on top.',
      },
    ],
  },
  '/about/architecture': {
    title: 'About: Architecture',
    summary: 'The stack, the data model, the load-bearing constraints, and the file map, for a reader who wants the mechanism.',
    sections: [
      {
        heading: 'Why this page is unlisted',
        body: 'Architecture renders at its own URL but appears in no nav or hub: it is written for a technical reader who lands on it directly, not part of the guided About tour.',
      },
    ],
  },
  '/costs': {
    title: 'How the costs console works',
    summary:
      'The whole running cost of the system: fixed platform subscriptions plus every metered model call the app makes, priced from the active rate card and frozen at call time.',
    sections: [
      {
        heading: 'Fixed plus metered',
        body: 'Fixed platform subscriptions are config edited here when a subscription changes. Metered spend is every Anthropic and OpenRouter call, priced against the rate card active at call time and rolled up by subsystem and by cron job.',
      },
      {
        heading: 'The forecast',
        body: 'Spend forecasts use a 14-day zero-filled daily mean times 30, not a cumulative run-rate, so a quiet week does not overstate the month-end projection.',
      },
    ],
  },
  '/pipeline': {
    title: 'How the discovery pipeline works',
    summary:
      'Discover, triage, and analyze candidate developments into draft signals for the Signal Board.',
    sections: [
      {
        heading: 'The daily run',
        body: 'Weekday discovery runs lens query batches over Tavily (LLM-free) plus a lens-agnostic breaking-events sweep, checkpointed so each unit fits well inside the function budget. Triage runs on the cheap utility model (Claude Sonnet when OpenRouter is not configured); analysis runs on Claude Sonnet by default, or on the OpenRouter models picked in the console for a per-candidate analysis A/B.',
      },
      {
        heading: 'Coverage and text',
        body: 'A post-run coverage check re-derives the window’s biggest developments independently and flags any this run may have missed, advisory only. The text-guard panel audits that every published signal still carries its retained source text and can refetch what is missing.',
      },
    ],
  },
  '/scan': {
    title: 'How the External Scan works',
    summary:
      'The daily outside-the-firewall sweep: press feeds and topic web searches, hydrated to full text and lightly enriched. The output that matters is one JSON file per day.',
    sections: [
      {
        heading: 'The sweep',
        body: 'Weekday runs (Monday also covers the weekend) pull press feeds and Tavily news search per topic, fetch full text, and enrich each item with a cheap model: summary, taxonomy tags, entities, and a source-reliability tier.',
      },
      {
        heading: 'What ships',
        body: 'The day’s items publish as the key-gated external-scan dataset; every published signal ships in the same row shape as signals-export, so one importer ingests both. The console carries the day grid, health panel, topic registry, and the importer handoff doc.',
      },
    ],
  },
  '/intel': {
    title: 'How the Intel Desk works',
    summary:
      'A daily company-intelligence sweep: press feeds, rotating web search, and EDGAR filings across a curated registry, hydrated to full text and enriched into structured facts and tags. The output that matters is four key-gated datasets.',
    sections: [
      {
        heading: 'The registry and the sweep',
        body: 'Companies are tiered (self, card issuer, consumer bank, fintech, tech platform, wildcard) in a registry seeded outside the public repo. Each weekday run cycles feeds, search, and SEC filings across a 3-day company ring; Monday runs also pull XBRL, FDIC, and CFPB metrics and close with a per-company dossier synthesis.',
      },
      {
        heading: 'Four datasets',
        body: 'intel-items mirrors external-scan’s column shape; intel-companies, intel-facts, and intel-metrics round out the registry, the extracted facts, and the metrics warehouse. All four are key-gated, with a generated importer handoff doc.',
      },
    ],
  },
  '/ingestion': {
    title: 'How the ingestion ledger works',
    summary: "The system's standing intake of the outside world, measured live, and what scaling it means.",
    sections: [
      {
        heading: 'What is measured',
        body: 'Today’s items and spend, the trailing 14-day corpus growth, and the full corpus retained to date: documents, characters, published signals, facts, and metric values, queried live from the three engines (scan, pipeline, intel).',
      },
      {
        heading: 'The 1000x question',
        body: 'A thought experiment on what scaling this intake a thousand times over would cost and require, worked out on the live numbers above and pinned to enterprise-platform subscription prices rather than a human baseline. The full argument is in the linked story deck.',
      },
    ],
  },
  '/tickets': {
    title: 'How the ticket desk works',
    summary: 'The feedback box: bugs found and features wished for, filed from the rail dialogs.',
    sections: [
      {
        heading: 'Where tickets come from',
        body: 'The "Report a bug" and "Request a feature" dialogs in the rail post to the public ticket intake, which is validated and rate-limited in-route. Screenshots are optional and downscaled client-side before upload.',
      },
      {
        heading: 'Working the queue',
        body: 'Each ticket carries a status (open, in progress, resolved, declined), an admin note, and up to three screenshots. Filters narrow by kind or status; open tickets lead the list by default.',
      },
    ],
  },
  '/agent': {
    title: 'How the Atlas Agent works',
    summary: 'The resident operator: what is slipping, what it did, what needs your tap.',
    sections: [
      {
        heading: 'Checks and tiers',
        body: 'A registry of SQL sensors watches the system across domains, each with a tiered remedy: some issues page for a look, others the agent can act on directly within its daily budget.',
      },
      {
        heading: 'The daily brief',
        body: 'A generated daily brief summarizes what moved and what needs attention; the sidebar tracks today’s spend against the daily cap and the archive of past briefs.',
      },
    ],
  },
  '/reports/[id]': {
    title: 'About this period report',
    summary: 'A saved period report: a fortnight or custom-range narrative compiled from the Signal Board, public once saved.',
    sections: [
      {
        heading: 'No publish gate',
        body: 'A period report is public the moment it is saved: there is no separate publish step, unlike a generated sheet. The branded PDF mirrors this same read view.',
      },
    ],
  },
  '/reports/sheet/[id]': {
    title: 'About this generated report',
    summary: 'A generated report: one claim, one lens, the whole Atlas, one of the four tooling reports (landscape, build-vs-buy brief, new entrants, features), or the Friday research roundup, citation-gated against the live corpus.',
    sections: [
      {
        heading: 'Draft until published',
        body: 'Public once published, admin-only as a draft. The tooling entrants report and the research roundup publish on their own when they run. The four tooling report kinds add one exception: a portal keyholder may also read a draft, since that console never auto-publishes a landscape, brief, or features report.',
      },
      {
        heading: 'The citation gate',
        body: 'Every link in the narrative was checked against the frozen data pack it was drafted over, at generation, at save, and again at render, so an edited or stale report cannot smuggle a citation back in.',
      },
    ],
  },
  '/research/[id]': {
    title: 'About a paper page',
    summary: 'One item in the research library: the structured finding, advisory Argument Map touches, and links to concepts and threads.',
    sections: [
      {
        heading: 'The finding is public',
        body: 'The structured finding (headline claim, the test, effect size, limitations, counterpoint, economy implication) is editorial content, like a signal brief, and is public once extracted. Review controls, the review note, rigor, promotion, and cached full text stay admin.',
      },
      {
        heading: 'Advisory, never evidence',
        body: 'Claim touches show what this paper bears on, but a paper never writes evidence directly: promoting it to a signal and publishing that signal is the only road onto the Argument Map.',
      },
    ],
  },
  '/research/threads/[slug]': {
    title: 'About a research thread',
    summary: 'A frontier question and its living synthesis, revised as tracked papers land, with its papers grouped by how each one relates.',
    sections: [
      {
        heading: 'The living synthesis',
        body: 'Model-maintained and admin-triggered, every rewrite is preserved in a revision trail. The synthesis and paper groupings are public; the update button, placement rationales, and revision history stay admin.',
      },
    ],
  },
  '/scout/[id]': {
    title: 'About a company profile',
    summary: 'A tracked or queued acquisition candidate: what it does, the AI tech itself, and a running event timeline.',
    sections: [
      {
        heading: 'Public once tracked',
        body: 'A profile is public only once a human has tracked it; a company still in the review queue 404s for guests, since a public signal of intent on a named startup would tip the company off. Team keyholders see queued profiles and can run research on them.',
      },
      {
        heading: 'Agent read, admin only',
        body: 'The verdict, the five rubric scores, and the reasoning behind them are recommend-only and never shown to a guest or portal keyholder, only to an admin doing the review.',
      },
    ],
  },
  '/tooling/[slug]': {
    title: 'About a product page',
    summary: 'A cataloged AI tool: facts, features, a machine-read dossier, an agent fit read, deep dive, and its event timeline.',
    sections: [
      {
        heading: 'Reading the page',
        body: 'Facts (deployment, pricing, founding, funding, integrations, compliance claims) sit above the feature tag list and the model-written dossier summary. Team keyholders additionally see the agent’s fit read and can trigger a deep dive; admins get review controls, tools, and the fact-editing form.',
      },
      {
        heading: 'Human edits win',
        body: 'Every automated write (enrichment, scoring, the deep dive) fills in only what is missing; a human fact edit is never overwritten by a later run.',
      },
    ],
  },
  '/education/[slug]': {
    title: 'About this guide',
    summary: 'A standalone guide, written up in house style and given a permanent home, with an optional 16:9 deck version.',
    sections: [
      {
        heading: 'Code, not a database row',
        body: 'Each guide is a component checked into the codebase, not an uploaded document, so it reads as edited prose rather than a feed item.',
      },
    ],
  },
  '/datasets/[slug]': {
    title: 'About this dataset',
    summary: 'A downloadable dataset with a documented schema, a methodology note, and an in-browser preview.',
    sections: [
      {
        heading: 'Schema and guest safety',
        body: 'Every column is allow-listed in code and shown in the schema table below; nothing from the personal layer (confidence numbers, review notes, priors) ever ships in a public dataset.',
      },
      {
        heading: 'Key-gated datasets',
        body: 'Some datasets, like the retained article full text, need the shared team key. Unlock once at the Ask page and both the preview and the download open up for the rest of the session.',
      },
    ],
  },
};

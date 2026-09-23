import type { PageInfoContent } from './page-info';

// Page explainer slice A (see lib/page-info.ts for the contract and voice).
// Covers the Signal Board admin/detail pages, Claims & Theses, the question
// pages, claim/bridge pages and their authoring forms, concepts, the map
// editor workspace (worldview/data/calibration/traceroute), the source
// library, and the theses workflow.
export const PAGE_INFO_A: Record<string, PageInfoContent> = {
  '/signals': {
    title: 'How the Signal Board works',
    summary:
      'Tracked developments in AI, organized by lens, each linked to the claims it touches on the Argument Map.',
    sections: [
      {
        heading: 'Reading a card',
        body: 'Each signal carries an audience lens and a significance level (high, medium, low), and links to the claims or bridge-claims it bears on. The direction of that link, how it bears on the claim, is shown to everyone.',
      },
      {
        heading: 'Where these come from',
        body: 'A weekday discovery pipeline drafts most signals from web search; some are added by hand from a source. Nothing is public until it is published, either by a human or, for high-significance pipeline drafts with a claim touch, by the 48-hour promotion policy; publishing is also the moment its findings enter the Argument Map as evidence.',
      },
      {
        heading: 'Guests vs. admin',
        body: 'Guests see published signals only. Admin also sees unpublished drafts here and works through them on the separate Drafts tab.',
      },
    ],
  },
  '/signals/new': {
    title: 'Adding a signal by hand',
    summary: "Note a development directly, or use a source's Propose signal button to draft it with AI.",
    sections: [
      {
        heading: 'What you fill in',
        body: 'A title, summary, significance, one or more audience lenses, and the claims or bridge-claims it touches, each with a direction and a reason.',
      },
      {
        heading: 'Draft, not published',
        body: 'A signal you create here lands unpublished. Review it from the signal page or the Drafts queue before it reaches the public feed and writes evidence.',
      },
    ],
  },
  '/signals/[id]': {
    title: 'Reading a signal',
    summary: 'A tracked development, its lens and significance, and the claims or bridge-claims it bears on.',
    sections: [
      {
        heading: 'The touches',
        body: 'Each claim or bridge-claim this signal names is listed with the direction it bears (public) and, for admin, the confidence word and the model\'s own reason for the read.',
      },
      {
        heading: 'Analyst tools',
        body: 'Admin can generate a cached deep-dive analysis, pull up the source\'s dossier, and ask questions scoped only to this signal, its source, and the claims it touches.',
      },
      {
        heading: 'Publishing is the gate',
        body: 'A draft signal has no effect on the Argument Map. Publishing it materializes one evidence row per touched claim or bridge; unpublishing or deleting it removes that evidence again.',
      },
    ],
  },
  '/signals/[id]/edit': {
    title: 'Editing a signal',
    summary: 'Change the title, summary, significance, lenses, claim touches, or source of an existing signal.',
    sections: [
      {
        heading: 'Touches carry direction and reason',
        body: 'Every claim or bridge-claim you wire in gets a direction (supports, contradicts, and so on) and a reason. Publishing rewrites the evidence this signal has already produced to match.',
      },
    ],
  },
  '/map': {
    title: 'How Claims & Theses reads',
    summary:
      'The standing theses, the falsifiable claims they stand on, and the six open questions where those claims settle.',
    sections: [
      {
        heading: 'Three layers',
        body: 'Theses at the top are standing hypotheses tracked against the signal corpus. Below them, the claims ledger: falsifiable statements, each with an evidence count and, for admin, a confidence word. Under that, the frame: the six neutral questions the claims settle on.',
      },
      {
        heading: 'The human gate',
        body: 'A confidence can never move without a rationale. Every move is a separate, logged action, visible on the calibration and claim pages.',
      },
      {
        heading: 'Gap diagnosis',
        body: 'Admin-only: the model reads recent reports and signals and argues for claims or bridges the map is missing. Recommending nothing is a normal outcome; every recommendation must cite its grounding, and a human still writes and confirms the new node.',
      },
    ],
  },
  '/q': {
    title: 'Reading a question',
    summary:
      'A neutral, open question, the stances that answer it, the claims that bear on each stance, and the bridge-claims that connect it to other domains.',
    sections: [
      {
        heading: 'The map',
        body: 'Claims and stances are drawn as a graph: hover a node to trace its supports and contradicts links. A claim can support one stance and contradict another.',
      },
      {
        heading: 'Neutral by design',
        body: 'The question itself takes no side. It exists only to frame the candidate stances underneath it, so the disagreement is visible rather than buried in one answer.',
      },
      {
        heading: 'State summaries',
        body: 'Admin can generate an AI narration of where the question currently stands. Each generation is saved, building a timeline rather than overwriting the last read.',
      },
    ],
  },
  '/q/[slug]/summary': {
    title: 'State summary history',
    summary: 'The AI question-state summary, saved per question and tracked over time.',
    sections: [
      {
        heading: 'What it reads',
        body: 'The claims, stances, and evidence under this question. The metrics are computed in code; the model only narrates what they mean.',
      },
      {
        heading: 'A timeline, not a snapshot',
        body: 'Every generation is kept, newest first, so you can compare how the read of a question has shifted over successive runs.',
      },
    ],
  },
  '/q/[slug]/claim/new': {
    title: 'Adding a claim',
    summary: 'Add a falsifiable claim to a question. Write the statement and its test, then wire it to the stances it bears on.',
    sections: [
      {
        heading: 'AI suggests the wiring',
        body: 'The model proposes which stances the claim supports or contradicts. You confirm each edge before creating; a claim must bear on at least one stance.',
      },
      {
        heading: 'From a gap diagnosis',
        body: 'Arriving here with a gap recommendation pre-fills the statement, test, and wiring from the model\'s draft, grounded in recent evidence. Review and edit everything before creating.',
      },
    ],
  },
  '/claim': {
    title: 'A claim page',
    summary: 'A falsifiable claim, its test, the evidence for and against it, and the confidence admin has moved to.',
    sections: [
      {
        heading: 'The human gate',
        body: 'A confidence can never move without its why. Every move writes a rationale and, optionally, cites a specific piece of evidence.',
      },
      {
        heading: 'Evidence',
        body: 'Each row supports, contradicts, or is neutral on the claim. A one-sided warning appears when every piece of evidence on record points the same way.',
      },
      {
        heading: 'Frames',
        body: 'A frame is an organizing belief that shapes which claims get looked for, but isn\'t itself cleanly falsifiable. It records what it organizes and is quarantined from evidence: it accumulates none.',
      },
    ],
  },
  '/bridges': {
    title: 'What a bridge-claim is',
    summary:
      'Bridge-claims are statements about the causal link between domains, not claims within one. Each has its own test and confidence, and is fed by claims from either domain.',
    sections: [
      {
        heading: 'Reading a card',
        body: 'The two domains it links, its statement and test, and, for admin, its confidence. Below that, the claims from either domain that feed it, each marked as supporting or contradicting.',
      },
      {
        heading: 'Why they exist',
        body: 'An argument that crosses domains needs a claim of its own instead of silently assuming the link. The spine is the full set of these bridge-claims in one place.',
      },
    ],
  },
  '/bridge': {
    title: 'A bridge-claim page',
    summary: 'The inter-domain claim: its test, the claims that feed it from either domain, and its evidence.',
    sections: [
      {
        heading: 'First-class, not an edge',
        body: 'A bridge-claim carries its own statement, test, and confidence, separate from any single claim it is fed by.',
      },
      {
        heading: 'The human gate',
        body: 'Confidence moves here the same way it does on a claim: a rationale every time, and a snapshot of every confidence in the Atlas written automatically.',
      },
    ],
  },
  '/bridge/new': {
    title: 'Adding a bridge-claim',
    summary: 'A bridge-claim links two domains. Write the inter-domain statement and its test, then wire the claims that feed it.',
    sections: [
      {
        heading: 'AI suggests, you confirm',
        body: 'The model proposes which claims feed the bridge from either domain. Review each one before creating.',
      },
      {
        heading: 'From a gap diagnosis',
        body: 'Arriving here with a gap recommendation pre-fills the statement, test, domains, and feeders from the model\'s draft. Review and edit everything before creating.',
      },
    ],
  },
  '/concepts': {
    title: 'How the concept scaffold works',
    summary:
      'The vocabulary the AI-economy debate is conducted in, stacked by dependency: foundational ideas at the bottom, the concepts built on them above.',
    sections: [
      {
        heading: 'Settled vs. contested',
        body: 'Most terms here have settled technical meanings. The contested ones are marked: their definition itself is disputed, so arguments that lean on them are often talking past each other.',
      },
      {
        heading: 'Reading the graph',
        body: 'Prerequisites sit below a concept, the concepts it builds toward sit above. Hover a node for its short definition.',
      },
      {
        heading: 'Gap diagnosis',
        body: 'Admin-only: the model reads the scaffold and the Argument Map and argues for concepts that are missing. A human reviews and confirms each one it creates.',
      },
    ],
  },
  '/concepts/[slug]': {
    title: 'A concept page',
    summary: "A term's definition, whether it is settled or contested, what you need to understand first, and what it builds toward.",
    sections: [
      {
        heading: 'Settled vs. contested',
        body: 'Settled means broad technical consensus on what the term means; disagreements that invoke it are about the world, not the word. Contested means the definition itself is disputed depending on who is using it.',
      },
      {
        heading: 'On the Argument Map',
        body: 'Claims that lean on this concept are linked below its definition, so you can see where the vocabulary is doing real argumentative work.',
      },
    ],
  },
  '/concepts/[slug]/edit': {
    title: 'Editing a concept',
    summary: "Change a concept's definition, explanation, status, prerequisites, or claim wiring.",
    sections: [
      {
        heading: 'AI suggests, you confirm',
        body: 'Prerequisite and claim-wiring recommendations are recommend-only; the form submit is the only writer.',
      },
      {
        heading: 'Deleting',
        body: 'Removes the concept, its dependency edges, and its claim links. Concepts that listed it as a prerequisite keep their own record; they just lose this edge.',
      },
    ],
  },
  '/concepts/new': {
    title: 'Adding a concept',
    summary: 'Define the term, then wire it in: which concepts a reader must understand first, and which claims on the map lean on it.',
    sections: [
      {
        heading: 'AI suggests both',
        body: 'Prerequisites and claim wiring are recommend-only. You confirm each one before creating.',
      },
      {
        heading: 'From a gap diagnosis',
        body: 'Arriving here with a gap recommendation pre-fills the definition, explanation, and wiring from the model\'s draft. Review and edit everything before creating.',
      },
    ],
  },
  '/worldview': {
    title: 'Worldview & spine',
    summary: 'The bridge-claims that link domains, and the cross-cutting positions that span more than one question.',
    sections: [
      {
        heading: 'The spine',
        body: 'Every bridge-claim in the Atlas, in one list, each with its confidence and the domains it links.',
      },
      {
        heading: 'Cross-cutting positions',
        body: "A position spans questions and doesn't map to any single stance, for example capability is real, the economics are shaky, and the market is heterogeneously mispriced. Link the stances, claims, and bridges that compose it, and move its confidence through the same human gate as everything else.",
      },
    ],
  },
  '/data': {
    title: 'The domain-text editor',
    summary:
      'Edit the text of the records directly. Saves write straight to the database and show across the site. Confidence keeps its own editor on the detail pages, and codes stay fixed.',
    sections: [
      {
        heading: "What's editable",
        body: 'Titles, summaries, statements, tests, and notes for every question, stance, claim, and bridge-claim.',
      },
      {
        heading: 'Lens tagging',
        body: 'Each stance, claim, and bridge-claim can also carry one or more audience lenses here, the same lenses the Signal Board filters by.',
      },
    ],
  },
  '/calibration': {
    title: 'Reading the confidence history',
    summary:
      'The living record: how your confidences have moved over time, and the reason behind every move. Each confidence move writes a snapshot automatically; capture one any time to freeze the current state.',
    sections: [
      {
        heading: 'The time-slider',
        body: 'Scrub through snapshots to see where every confidence stood at a given moment, and how a claim\'s trajectory looks over time.',
      },
      {
        heading: 'The move log',
        body: 'Every row is a rationale: the old and new confidence, and, when the author cited one, the evidence behind the move.',
      },
    ],
  },
  '/traceroute': {
    title: 'What Traceroute shows',
    summary:
      'Language models run locally or in a datacenter. This traces a cloud request end to end: what happens between pressing enter and the first token coming back.',
    sections: [
      {
        heading: 'Four movements',
        body: 'Ten camera stops carry you through the network path, the datacenter, and the compute stack that produces a single generated token.',
      },
      {
        heading: 'Play, pause, step',
        body: 'Let the walkthrough run on its own, or step through it a token at a time at your own pace.',
      },
    ],
  },
  '/sources': {
    title: 'The source library',
    summary: "The source library: filter sources, view dossiers, and see which claims each source's evidence attaches to.",
    sections: [
      {
        heading: 'The dossier',
        body: "An AI-generated profile of a source: its thesis, external facts about the author and outlet, and one analytic caveat. It's descriptive, not a score.",
      },
      {
        heading: 'Reliability prior',
        body: "Set by hand on each source's own page, separate from the dossier. The model never sets this number.",
      },
    ],
  },
  '/ingest': {
    title: 'Adding a source',
    summary: 'Drop a PDF or an article and it becomes a source with an AI dossier.',
    sections: [
      {
        heading: 'From a source page',
        body: 'Attach evidence to specific claims, or turn the source into a Signal Board draft through the same triage the discovery pipeline runs.',
      },
      {
        heading: "Evidence doesn't move confidence on its own",
        body: 'Attaching evidence and moving a confidence are two separate actions. A confidence move always needs its own rationale.',
      },
    ],
  },
  '/source/[id]': {
    title: 'A source page',
    summary: "A single ingested source: its AI dossier, the reliability prior you set, and the evidence attached to it.",
    sections: [
      {
        heading: 'The dossier is descriptive, not a score',
        body: "A profile of the source's thesis and known facts about its author and outlet, each tagged by how it is known. Reliability is set separately, by hand, below it.",
      },
      {
        heading: 'Turning it into other things',
        body: 'Attach evidence to specific claims, turn it into a Signal Board draft through the same triage the discovery pipeline runs, or send it to the research library. The same source can go through more than one of these.',
      },
    ],
  },
  '/theses': {
    title: 'The theses workflow',
    summary:
      'Standing hypotheses tracked against the signal corpus. State a thesis, confirm which Atlas claims it bears on, and generate a deterministic, cited report to share.',
    sections: [
      {
        heading: 'Four steps',
        body: 'Each thesis works through the same arc: edit the statement and its mapping, see the logic tree it stands on, run a thesis-scoped gap diagnosis, then generate reports.',
      },
      {
        heading: 'Sharing',
        body: 'A saved run gets a public, read-only report link and a branded PDF, no session required to view it.',
      },
    ],
  },
  '/theses/new': {
    title: 'Starting a thesis',
    summary:
      'State the hypothesis in plain language, let the mapper propose the Atlas claims it bears on, and confirm the mapping. You commit; the model only recommends.',
    sections: [
      {
        heading: 'What happens next',
        body: 'Creating a thesis takes you straight to its workflow page, with the mapping form open if it has no claims yet.',
      },
      {
        heading: 'Mapping is optional at first',
        body: "You can map it later; an unmapped thesis still exists, it just runs its reports text-only until claims are attached.",
      },
    ],
  },
  '/theses/[id]': {
    title: 'The thesis workflow page',
    summary: 'The four-step arc for one thesis: edit it and its mapping, see the logic tree, run the gap diagnosis, then generate reports.',
    sections: [
      {
        heading: 'The logic tree',
        body: 'The thesis, its mapped claims and bridges with their confidence bands, and the questions they answer, drawn as a graph. Gap recommendations appear as dashed ghost nodes linking straight to a draft form.',
      },
      {
        heading: 'The gap diagnosis',
        body: 'Scoped to this thesis: the model reads it, its mapped claims, and the signals its text attracts, and argues for the few claims it depends on that the map is missing.',
      },
      {
        heading: 'Reports',
        body: 'The frozen, cited artifact this workflow builds toward. Each saved run gets its own shareable public link and PDF.',
      },
    ],
  },
  '/thesis-report/[id]': {
    title: 'Reading a thesis report',
    summary: "A frozen, cited report generated from one thesis's mapped claims and the signals that touch them.",
    sections: [
      {
        heading: 'Grounded and gated',
        body: "The narrative is checked against its own frozen data pack before it renders, so it can never cite outside the evidence it was generated from.",
      },
      {
        heading: 'Sharing',
        body: 'Public and downloadable as a branded PDF. No session is required to view it.',
      },
    ],
  },
};

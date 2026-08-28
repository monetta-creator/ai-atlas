import type { DatasetColumn, DatasetDef, DatasetRow } from './core';
// Explicit .ts extension so plain Node (scripts/test-datasets.mjs, type
// stripping) can load this module chain; the bundler resolves it the same.
import {
  buildArgumentEdges, buildArgumentNodes, buildArticlesFullText, buildConcepts,
  buildEvidenceLedger, buildExternalScan, buildResearchPapers, buildScoutCompanies,
  buildScoutEvents, buildSignals, buildSignalsByClaim, buildSources, buildThesisReports,
} from './builders.ts';

// The ordered dataset catalog. Registry text is user-facing: plain sentences,
// no em dashes, every column carries a one-line def (rendered on the dataset
// page and exported by the `catalog` dataset).

const col = (
  key: string, label: string, type: DatasetColumn['type'], def: string
): DatasetColumn => ({ key, label, type, def });

const PUBLISHED_NOTE =
  'Only published signals are included. Draft and archived work never enters a dataset.';

const BASE: DatasetDef[] = [
  {
    slug: 'signals',
    title: 'Signals feed',
    description:
      'Every published signal on the board: one tracked AI development per row, with its significance, audience lenses, touched claims, and the analyst brief (what happened, why it matters, what is contested) plus the counterpoint.',
    methodology:
      `The flagship dataset. Rows mirror the public Signal Board feed exactly. ${PUBLISHED_NOTE} The brief and counterpoint columns are model-drafted prose reviewed by a human before publish. Add ?lens=market (or labor, geopolitics, regulatory, capability, society) to a download URL for a single-lens slice.`,
    category: 'signals',
    formats: ['csv', 'json'],
    filters: { lens: true },
    columns: [
      col('signal_id', 'Signal ID', 'text', 'Stable UUID; links to /signals/<id>.'),
      col('title', 'Title', 'text', 'Headline of the tracked development.'),
      col('summary', 'Summary', 'longtext', 'One-paragraph editorial summary.'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('lenses', 'Lenses', 'text', 'Audience lenses, joined with a semicolon: market, labor, geopolitics, regulatory, capability, society.'),
      col('published_on', 'Published', 'date', 'Editorial date (YYYY-MM-DD); drives feed order.'),
      col('origin', 'Origin', 'enum', 'manual (curated by hand) or pipeline (web discovery).'),
      col('claim_touches', 'Claim touches', 'text', 'Codes of the argument-map claims this development bears on, joined with a semicolon.'),
      col('source_title', 'Source title', 'text', 'Title of the underlying article, when one is linked.'),
      col('source_url', 'Source URL', 'text', 'Link to the original article.'),
      col('source_domain', 'Source domain', 'text', 'Hostname of the source URL, www stripped.'),
      col('brief_what_happened', 'What happened', 'longtext', 'The development itself, in plain prose.'),
      col('brief_why_it_matters', 'Why it matters', 'longtext', 'The stakes: what this changes.'),
      col('brief_whats_contested', 'What is contested', 'longtext', 'Where reasonable readers still disagree.'),
      col('counterpoint', 'Counterpoint', 'longtext', 'A steelman of the contrary reading.'),
    ],
    build: buildSignals,
  },
  {
    slug: 'argument-nodes',
    title: 'Argument map nodes',
    description:
      'Every node of the argument map in one flat table: the open questions, the candidate stances under them, the falsifiable claims with their tests, the organizing frames, and the bridge claims that link domains.',
    methodology:
      'One row per node with a node_type discriminator. Confidence values are the author\'s personal layer and are deliberately absent; what is public is the structure: statements, tests, domains, and lens tags. Wiring between nodes lives in the argument-edges dataset.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('node_type', 'Node type', 'enum', 'question, stance, claim, frame, or bridge_claim.'),
      col('code', 'Code', 'text', 'Stable identifier: a slug for questions, a short code (2.3, B1, F1) otherwise.'),
      col('statement', 'Statement', 'longtext', 'The node\'s title or claim statement.'),
      col('summary', 'Summary', 'longtext', 'Supporting summary, where the node carries one.'),
      col('test', 'Test', 'longtext', 'What evidence would move this node; the falsifiability contract.'),
      col('domain', 'Domain', 'enum', 'Claim domain: capability, economics, build_out, market, or labor.'),
      col('domain_from', 'Domain from', 'enum', 'Bridge claims only: the upstream domain.'),
      col('domain_to', 'Domain to', 'enum', 'Bridge claims only: the downstream domain.'),
      col('question', 'Question', 'text', 'Stances only: the parent question slug.'),
      col('holder', 'Holder', 'text', 'Stances only: who typically holds this position.'),
      col('is_frame', 'Is frame', 'enum', 'yes for organizing frames (no test, no evidence), no otherwise.'),
      col('resolvability', 'Resolvability', 'enum', 'clean, slow, or qualitative: how decisively the test can settle.'),
      col('lens_tags', 'Lens tags', 'text', 'Argument-map lens tags, joined with a semicolon.'),
      col('href', 'Link', 'text', 'Path of the node\'s public page on the Atlas.'),
    ],
    build: buildArgumentNodes,
  },
  {
    slug: 'argument-edges',
    title: 'Argument map edges',
    description:
      'The wiring of the argument map: which claims support or contradict which stances, which claims feed the bridge claims, and which frames organize what.',
    methodology:
      'One row per edge, with node UUIDs resolved to their stable codes at build time. The edges table enforces no referential integrity, so edges whose endpoints no longer resolve are dropped rather than exported dangling. Join from_code and to_code against the argument-nodes dataset.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('from_type', 'From type', 'enum', 'stance, claim, or bridge_claim.'),
      col('from_code', 'From code', 'text', 'Code of the edge\'s source node.'),
      col('to_type', 'To type', 'enum', 'stance, claim, or bridge_claim.'),
      col('to_code', 'To code', 'text', 'Code of the edge\'s target node.'),
      col('relation', 'Relation', 'enum', 'supports, contradicts, depends_on, or organizes.'),
    ],
    build: buildArgumentEdges,
  },
  {
    slug: 'evidence-ledger',
    title: 'Evidence ledger',
    description:
      'Every public evidence row: which source or signal bears on which claim, in which direction, at what weight, with the quoted excerpt.',
    methodology:
      `One row per evidence record targeting a claim or bridge claim. Provenance is a source (manual ingest), a published signal (materialized on publish), or both. ${PUBLISHED_NOTE} The admin\'s private note and source reliability priors never enter this dataset.`,
    category: 'evidence',
    formats: ['csv', 'json'],
    columns: [
      col('evidence_id', 'Evidence ID', 'text', 'Stable UUID of the evidence row.'),
      col('target_type', 'Target type', 'enum', 'claim or bridge_claim.'),
      col('target_code', 'Target code', 'text', 'Code of the claim or bridge claim the evidence bears on.'),
      col('target_statement', 'Target statement', 'longtext', 'Statement of the targeted node.'),
      col('direction', 'Direction', 'enum', 'supports, contradicts, or neutral.'),
      col('weight', 'Weight', 'enum', 'high, medium, or low.'),
      col('excerpt', 'Excerpt', 'longtext', 'The quoted passage that carries the finding.'),
      col('lens', 'Lens', 'enum', 'Audience lens the finding speaks to, when tagged.'),
      col('signal_id', 'Signal ID', 'text', 'Publishing signal, when signal-anchored.'),
      col('signal_title', 'Signal title', 'text', 'Title of the publishing signal.'),
      col('source_title', 'Source title', 'text', 'Title of the anchoring source, when source-anchored.'),
      col('source_url', 'Source URL', 'text', 'Link to the anchoring source.'),
      col('added_on', 'Added', 'date', 'When the evidence row was created (YYYY-MM-DD).'),
    ],
    build: buildEvidenceLedger,
  },
  {
    slug: 'sources',
    title: 'Source bibliography',
    description:
      'The bibliography behind the Atlas: every source that backs at least one evidence row or one published signal, with counts and a full-text availability flag.',
    methodology:
      'Unreferenced working uploads are excluded; a source appears once it is publicly cited. has_full_text says whether the articles-full-text dataset carries its text. Reliability priors and AI dossiers are the admin\'s personal layer and are absent.',
    category: 'sources',
    formats: ['csv', 'json'],
    columns: [
      col('source_id', 'Source ID', 'text', 'Stable UUID of the source.'),
      col('title', 'Title', 'text', 'Title of the article, paper, or document.'),
      col('author', 'Author', 'text', 'Author, when known.'),
      col('outlet', 'Outlet', 'text', 'Publishing outlet.'),
      col('url', 'URL', 'text', 'Link to the original.'),
      col('source_domain', 'Domain', 'text', 'Hostname of the URL, www stripped.'),
      col('published_on', 'Published', 'date', 'Publication date (YYYY-MM-DD), when known.'),
      col('domain_tag', 'Domain tag', 'enum', 'Argument domain the source was filed under, when tagged.'),
      col('evidence_count', 'Evidence rows', 'number', 'How many evidence rows cite this source.'),
      col('published_signal_count', 'Published signals', 'number', 'How many published signals carry this source.'),
      col('has_full_text', 'Has full text', 'enum', 'yes when the articles-full-text dataset carries text for it.'),
    ],
    build: buildSources,
  },
  {
    slug: 'articles-full-text',
    title: 'Articles, full text',
    description:
      'The complete retained text of every published signal\'s underlying article: curated source text where it exists, otherwise the page text the discovery pipeline fetched.',
    methodology:
      'One row per published signal that has text; curated source text wins over pipeline-cached text. This is a working corpus for internal research, provenance, and quotation. It is not a redistribution channel: do not republish articles outside the company, and link to the original source when sharing outward. Downloading requires the team portal key.',
    category: 'sources',
    formats: ['csv', 'json'],
    heavy: true,
    keyGated: true,
    columns: [
      col('signal_id', 'Signal ID', 'text', 'The published signal this text belongs to.'),
      col('signal_title', 'Signal title', 'text', 'Title of the signal.'),
      col('published_on', 'Published', 'date', 'Signal\'s editorial date (YYYY-MM-DD).'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('lenses', 'Lenses', 'text', 'Audience lenses, joined with a semicolon.'),
      col('source_title', 'Source title', 'text', 'Title of the underlying article.'),
      col('outlet', 'Outlet', 'text', 'Publishing outlet, when known.'),
      col('source_url', 'Source URL', 'text', 'Link to the original article.'),
      col('text_chars', 'Text length', 'number', 'Character count of the retained text.'),
      col('full_text', 'Full text', 'longtext', 'The complete retained article text.'),
    ],
    build: buildArticlesFullText,
  },
  {
    slug: 'concepts',
    title: 'Concept scaffold',
    description:
      'The AI terminology dependency graph: every concept with its short definition, full explanation, settled or contested status, prerequisite concepts, and linked argument-map claims.',
    methodology:
      'The learning path is the prerequisites column: understand those slugs before this one. The graph is kept acyclic by the writer. Claim links are human-confirmed only.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('slug', 'Slug', 'text', 'Stable identifier; links to /concepts/<slug>.'),
      col('name', 'Name', 'text', 'Display name of the concept.'),
      col('short_definition', 'Short definition', 'text', 'One-sentence definition.'),
      col('explanation', 'Explanation', 'longtext', 'The full explainer prose.'),
      col('status', 'Status', 'enum', 'settled (broad agreement) or contested (live disagreement).'),
      col('prerequisites', 'Prerequisites', 'text', 'Concept slugs to understand first, joined with a semicolon.'),
      col('linked_claims', 'Linked claims', 'text', 'Argument-map claim codes this concept underpins, joined with a semicolon.'),
    ],
    build: buildConcepts,
  },
  {
    slug: 'signals-by-claim',
    title: 'Signals by claim',
    description:
      'The touch matrix in long form: one row for every published signal that bears on every claim it touches, with the direction of the touch. The dataset for direction-balance questions.',
    methodology:
      `Pivot claim_code against direction to see the support and contradiction balance per claim. ${PUBLISHED_NOTE} Direction comes from the evidence row the publish gate materialized; a blank direction means the touch predates direction tracking.`,
    category: 'evidence',
    formats: ['csv', 'json'],
    columns: [
      col('claim_code', 'Claim code', 'text', 'Code of the touched claim or bridge claim.'),
      col('claim_type', 'Claim type', 'enum', 'claim or bridge_claim.'),
      col('claim_statement', 'Claim statement', 'longtext', 'Statement of the touched node.'),
      col('signal_id', 'Signal ID', 'text', 'The touching signal.'),
      col('signal_title', 'Signal title', 'text', 'Title of the touching signal.'),
      col('published_on', 'Published', 'date', 'Signal\'s editorial date (YYYY-MM-DD).'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('lenses', 'Lenses', 'text', 'Audience lenses, joined with a semicolon.'),
      col('direction', 'Direction', 'enum', 'supports, contradicts, or neutral; blank when untracked.'),
    ],
    build: buildSignalsByClaim,
  },
  {
    slug: 'thesis-reports',
    title: 'Thesis reports',
    description:
      'The standing-hypothesis scoreboard: every saved thesis report with its matched-signal counts, direction balance, one-sidedness and thin-coverage flags, and a link to the full public report.',
    methodology:
      'Each row reads the frozen, guest-safe stats pack of a saved report; the statement is frozen at generation time. one_sided and thin are the same caveat flags the report page itself shows.',
    category: 'meta',
    formats: ['csv', 'json'],
    columns: [
      col('report_id', 'Report ID', 'text', 'Stable UUID of the saved report.'),
      col('thesis_statement', 'Thesis', 'longtext', 'The hypothesis as frozen at generation time.'),
      col('claim_codes', 'Mapped claims', 'text', 'Argument-map codes the thesis is mapped to, joined with a semicolon.'),
      col('generated_on', 'Generated', 'date', 'When the report was generated (YYYY-MM-DD).'),
      col('signals_scanned', 'Scanned', 'number', 'Published signals in the corpus at generation time.'),
      col('signals_matched', 'Matched', 'number', 'Signals matched to the thesis.'),
      col('supporting', 'Supporting', 'number', 'Matched signals whose touches support the thesis claims.'),
      col('contradicting', 'Contradicting', 'number', 'Matched signals whose touches contradict.'),
      col('mixed', 'Mixed', 'number', 'Matched signals with touches in both directions.'),
      col('neutral', 'Neutral', 'number', 'Matched signals with neutral touches only.'),
      col('untyped', 'Untyped', 'number', 'Matched signals with no direction data.'),
      col('one_sided', 'One-sided', 'enum', 'yes when support exists with zero contradiction; a coverage warning, not a verdict.'),
      col('thin', 'Thin', 'enum', 'yes when fewer than five signals matched.'),
      col('first_matched', 'First matched', 'date', 'Earliest matched signal date.'),
      col('last_matched', 'Last matched', 'date', 'Latest matched signal date.'),
      col('report_url', 'Report URL', 'text', 'Public path of the full narrative report.'),
    ],
    build: buildThesisReports,
  },
  {
    slug: 'research-papers',
    title: 'Research papers',
    description:
      'The curated arXiv shortlist: papers the research pipeline kept, with abstracts, triage summaries, advisory claim links, and citation counts.',
    methodology:
      'Kept papers only, never the raw scan funnel. claim_touches here is advisory: papers do not write evidence; a paper enters the argument map only by promotion to a signal. The reviewer\'s private notes and priors are absent.',
    category: 'research',
    formats: ['csv', 'json'],
    columns: [
      col('arxiv_id', 'arXiv ID', 'text', 'arXiv identifier, when the paper came from arXiv.'),
      col('title', 'Title', 'text', 'Paper title.'),
      col('url', 'URL', 'text', 'Link to the paper.'),
      col('abstract', 'Abstract', 'longtext', 'The paper\'s abstract.'),
      col('categories', 'Categories', 'text', 'arXiv categories, joined with a semicolon.'),
      col('published_on', 'Published', 'date', 'Paper date (YYYY-MM-DD).'),
      col('triage_summary', 'Triage summary', 'longtext', 'Why the pipeline kept it, in one paragraph.'),
      col('advisory_claim_touches', 'Advisory claim touches', 'text', 'Claim codes the paper may bear on; advisory only.'),
      col('suggested_concepts', 'Suggested concepts', 'text', 'Concept slugs the paper speaks to.'),
      col('citation_count', 'Citations', 'number', 'Citation count at last check.'),
      col('promoted_signal_id', 'Promoted signal', 'text', 'Signal ID when the paper was promoted to the board.'),
    ],
    build: buildResearchPapers,
  },
  {
    slug: 'scout-companies',
    title: 'Scout: tracked companies',
    description:
      'The Startup Scout watchlist: young AI companies tracked as acquisition candidates, organized by vertical, with what each builds and the AI technology itself.',
    methodology:
      'Only tracked companies are included. The review funnel, the scoring agent\'s advisory verdicts and scores, review notes, and dossiers never enter a dataset. Facts come from discovery, homepage enrichment, and hand edits; web-sourced facts can be imprecise.',
    category: 'scout',
    formats: ['csv', 'json'],
    columns: [
      col('company_id', 'Company ID', 'text', 'Stable UUID; the profile URL is /scout/<id>.'),
      col('name', 'Name', 'text', 'Company name.'),
      col('domain', 'Domain', 'text', 'Bare homepage host, when known.'),
      col('url', 'URL', 'text', 'Homepage URL, when known.'),
      col('vertical', 'Vertical slug', 'text', 'The acquisition-thesis vertical the company is filed under.'),
      col('vertical_name', 'Vertical', 'text', 'Display name of the vertical.'),
      col('one_liner', 'One-liner', 'longtext', 'What the company builds, in one sentence.'),
      col('ai_tech', 'AI tech', 'longtext', 'The AI technology itself, as concretely as sources allow.'),
      col('stage', 'Stage', 'enum', 'pre_seed, seed, series_a, series_b, later, or unknown.'),
      col('founded_year', 'Founded', 'number', 'Founding year, when reported.'),
      col('funding_note', 'Funding note', 'text', 'Latest reported round, free text.'),
      col('hq', 'HQ', 'text', 'Headquarters, when reported.'),
      col('origin', 'Origin', 'enum', 'discovery (found by the web sweep) or manual (added by hand).'),
      col('tracked_since', 'Tracked since', 'date', 'When the company cleared review onto the watchlist (YYYY-MM-DD).'),
      col('event_count', 'Events', 'number', 'Timeline events logged for the company.'),
    ],
    build: buildScoutCompanies,
  },
  {
    slug: 'scout-events',
    title: 'Scout: company events',
    description:
      'The event timelines of tracked Scout companies: funding rounds, launches, and notable news, one row per event.',
    methodology:
      'Events on tracked companies only, matching what each public profile timeline shows. Logged by hand or by the research tools; each carries its source URL when one was reported.',
    category: 'scout',
    formats: ['csv', 'json'],
    columns: [
      col('event_id', 'Event ID', 'text', 'Stable UUID of the event.'),
      col('company_id', 'Company ID', 'text', 'The company the event belongs to; joins scout-companies.'),
      col('company_name', 'Company', 'text', 'Company name, denormalized for convenience.'),
      col('vertical', 'Vertical slug', 'text', 'The company\'s vertical.'),
      col('event_date', 'Date', 'date', 'Event date (YYYY-MM-DD).'),
      col('kind', 'Kind', 'enum', 'funding, launch, news, milestone, or note.'),
      col('title', 'Title', 'text', 'One-line description of the event.'),
      col('url', 'URL', 'text', 'Source link, when one was reported.'),
    ],
    build: buildScoutEvents,
  },
  {
    slug: 'external-scan',
    title: 'External scan, daily',
    description:
      'One day of the automated external news scan: items across financial services and technology topics discovered from public press feeds and web search, with full text, a model summary, taxonomy tags, and named entities.',
    methodology:
      'One row per item in one day\'s scan run; the latest completed day by default, or add ?day=YYYY-MM-DD for a specific day. Discovery is public press feeds plus per-topic web searches; page text is fetched directly with a reader fallback; enrichment is a small model pass whose tags come from a fixed topic taxonomy. relevance is advisory and downstream triage is expected. This is a working corpus, not a redistribution channel. Downloading requires the team portal key.',
    category: 'scan',
    formats: ['csv', 'json'],
    heavy: true,
    keyGated: true,
    filters: { day: true },
    columns: [
      col('item_id', 'Item ID', 'text', 'Stable UUID of the scanned item.'),
      col('run_day', 'Run day', 'date', 'The scan day (YYYY-MM-DD, UTC).'),
      col('url', 'URL', 'text', 'The item URL as discovered.'),
      col('normalized_url', 'Normalized URL', 'text', 'Canonical dedupe form: host plus path plus sorted query, tracking params stripped.'),
      col('headline', 'Headline', 'text', 'Headline as reported by the feed or search.'),
      col('source_domain', 'Source domain', 'text', 'Hostname of the URL, www stripped.'),
      col('published_on', 'Published', 'date', 'Publication date when known (YYYY-MM-DD).'),
      col('discovered_via', 'Discovered via', 'text', 'The discovering topic\'s slug for a feed item, or web_search.'),
      col('topic_slug', 'Topic slug', 'text', 'The scan topic that discovered the item.'),
      col('topic_code', 'Topic code', 'text', 'Taxonomy code of that topic.'),
      col('summary', 'Summary', 'longtext', 'Two to three model-written sentences; empty when enrichment was skipped.'),
      col('tags', 'Tags', 'text', 'Taxonomy codes the enrichment assigned, joined with a semicolon.'),
      col('entities', 'Entities', 'text', 'Companies, agencies, and people named, joined with a semicolon.'),
      col('relevance', 'Relevance', 'number', 'Advisory 0 to 1 relevance score from enrichment.'),
      col('enrich_status', 'Enrich status', 'enum', 'done, skipped, error, or pending.'),
      col('fetch_status', 'Fetch status', 'enum', 'done, failed, skipped, or pending.'),
      col('fetched_via', 'Fetched via', 'enum', 'direct or jina.'),
      col('text_chars', 'Text length', 'number', 'Character count of the retained page text.'),
      col('full_text', 'Full text', 'longtext', 'The complete retained page text, capped at 24,000 characters.'),
    ],
    build: buildExternalScan,
  },
];

const CATALOG: DatasetDef = {
  slug: 'catalog',
  title: 'Dataset catalog',
  description:
    'The portal\'s own schema, as data: one row per column of every dataset, with its type and definition. The machine-readable answer to what is in the Atlas.',
  methodology:
    'Generated from the dataset registry itself, so it can never drift from the real schema. Feed it to a script, a notebook, or a model to orient before querying.',
  category: 'meta',
  formats: ['csv', 'json'],
  columns: [
    col('dataset_slug', 'Dataset slug', 'text', 'Slug of the dataset; its download URL is /api/datasets/<slug>.'),
    col('dataset_title', 'Dataset title', 'text', 'Display title of the dataset.'),
    col('category', 'Category', 'enum', 'argument-graph, signals, evidence, sources, research, scout, scan, or meta.'),
    col('column_key', 'Column key', 'text', 'Machine name of the column; the CSV header.'),
    col('column_label', 'Column label', 'text', 'Display name of the column.'),
    col('column_type', 'Column type', 'enum', 'text, number, date, enum, or longtext.'),
    col('column_def', 'Column definition', 'text', 'One-line gloss of what the column holds.'),
  ],
  build: async () => {
    const rows: DatasetRow[] = [];
    for (const d of BASE) {
      for (const c of d.columns) {
        rows.push({
          dataset_slug: d.slug, dataset_title: d.title, category: d.category,
          column_key: c.key, column_label: c.label, column_type: c.type, column_def: c.def,
        });
      }
    }
    for (const c of CATALOG.columns) {
      rows.push({
        dataset_slug: 'catalog', dataset_title: CATALOG.title, category: CATALOG.category,
        column_key: c.key, column_label: c.label, column_type: c.type, column_def: c.def,
      });
    }
    return rows;
  },
};

export const DATASETS: DatasetDef[] = [...BASE, CATALOG];

export function getDataset(slug: string): DatasetDef | null {
  return DATASETS.find((d) => d.slug === slug) ?? null;
}

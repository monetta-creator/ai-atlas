import type { DatasetColumn, DatasetDef, DatasetRow } from './core';
// Explicit .ts extension so plain Node (scripts/test-datasets.mjs, type
// stripping) can load this module chain; the bundler resolves it the same.
import {
  buildArticlesFullText, buildConcepts,
  buildEvidenceLedger, buildHypotheses, buildHypothesisLinks, buildHypothesisReports,
  buildResearchPapers, buildSignals, buildSignalsByHypothesis, buildSources,
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
      'Every published signal on the board: one tracked development per row, with its significance, context, touched hypotheses, and the analyst brief (what happened, why it matters, what is contested) plus the counterpoint.',
    methodology:
      `The flagship dataset. Rows mirror the public Signal Board feed exactly. ${PUBLISHED_NOTE} The brief and counterpoint columns are model-drafted prose reviewed by a human before publish. Add ?context=internal (or external) to a download URL for a single-context slice.`,
    category: 'signals',
    formats: ['csv', 'json'],
    filters: { context: true },
    columns: [
      col('signal_id', 'Signal ID', 'text', 'Stable UUID; links to /signals/<id>.'),
      col('title', 'Title', 'text', 'Headline of the tracked development.'),
      col('summary', 'Summary', 'longtext', 'One-paragraph editorial summary.'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('context', 'Context', 'enum', 'internal (originating inside the organization) or external.'),
      col('published_on', 'Published', 'date', 'Editorial date (YYYY-MM-DD); drives feed order.'),
      col('origin', 'Origin', 'enum', 'manual (curated by hand) or pipeline (intake).'),
      col('touches', 'Touches', 'text', 'Codes of the hypotheses this development bears on, joined with a semicolon.'),
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
    slug: 'hypotheses',
    title: 'Hypothesis board',
    description:
      'Every tracked hypothesis in one flat table: the statement, the falsification test, status, resolvability, and the public evidence tallies.',
    methodology:
      'One row per hypothesis. Conviction values are the operator\'s personal layer and are deliberately absent; what is public is the structure: statements, tests, and the evidence counts. The links between hypotheses live in the hypothesis-links dataset.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('code', 'Code', 'text', 'Stable identifier (H1, H2, ...).'),
      col('statement', 'Statement', 'longtext', 'The hypothesis statement.'),
      col('test', 'Test', 'longtext', 'What evidence would move it; the falsifiability contract.'),
      col('status', 'Status', 'enum', 'active, retired, or resolved.'),
      col('resolvability', 'Resolvability', 'enum', 'clean, slow, or qualitative: how decisively the test can settle.'),
      col('evidence_count', 'Evidence rows', 'number', 'How many evidence rows attach to it.'),
      col('supporting', 'Supporting', 'number', 'Evidence rows in the supports direction.'),
      col('contradicting', 'Contradicting', 'number', 'Evidence rows in the contradicts direction.'),
      col('signal_count', 'Signals', 'number', 'Distinct published signals whose evidence touches it.'),
      col('href', 'Link', 'text', 'Path of the hypothesis\'s public page on the Atlas.'),
    ],
    build: buildHypotheses,
  },
  {
    slug: 'hypothesis-links',
    title: 'Hypothesis links',
    description:
      'The relations between hypotheses: which narrower or adjacent hypotheses were promoted from which, and which stand related.',
    methodology:
      'One row per link, with UUIDs resolved to stable codes at build time. Join from_code and to_code against the hypotheses dataset.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('from_code', 'From code', 'text', 'Code of one end of the link.'),
      col('to_code', 'To code', 'text', 'Code of the other end.'),
      col('link_note', 'Link note', 'text', 'Why they are linked, when recorded.'),
    ],
    build: buildHypothesisLinks,
  },
  {
    slug: 'evidence-ledger',
    title: 'Evidence ledger',
    description:
      'Every public evidence row: which source or signal bears on which hypothesis, in which direction, at what confidence, with the quoted excerpt.',
    methodology:
      `One row per evidence record. Provenance is a source (manual ingest), a published signal (materialized on publish), or both. ${PUBLISHED_NOTE} The admin\'s private note and source reliability priors never enter this dataset.`,
    category: 'evidence',
    formats: ['csv', 'json'],
    columns: [
      col('evidence_id', 'Evidence ID', 'text', 'Stable UUID of the evidence row.'),
      col('hypothesis_code', 'Hypothesis code', 'text', 'Code of the hypothesis the evidence bears on.'),
      col('hypothesis_statement', 'Hypothesis statement', 'longtext', 'Statement of the hypothesis.'),
      col('direction', 'Direction', 'enum', 'supports, contradicts, or neutral.'),
      col('confidence', 'Confidence', 'enum', 'high, medium, or low: the operator\'s weight on this link.'),
      col('excerpt', 'Excerpt', 'longtext', 'The quoted passage that carries the finding.'),
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
      'The complete retained text of every published signal\'s underlying document: curated source text where it exists, otherwise the text retained at intake.',
    methodology:
      'One row per published signal that has text; curated source text wins over intake-cached text. This is a working corpus for internal research, provenance, and quotation. It is not a redistribution channel: do not republish documents outside the company, and link to the original source when sharing outward. Downloading requires the team portal key.',
    category: 'sources',
    formats: ['csv', 'json'],
    heavy: true,
    keyGated: true,
    columns: [
      col('signal_id', 'Signal ID', 'text', 'The published signal this text belongs to.'),
      col('signal_title', 'Signal title', 'text', 'Title of the signal.'),
      col('published_on', 'Published', 'date', 'Signal\'s editorial date (YYYY-MM-DD).'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('context', 'Context', 'enum', 'internal or external.'),
      col('source_title', 'Source title', 'text', 'Title of the underlying document.'),
      col('outlet', 'Outlet', 'text', 'Publishing outlet, when known.'),
      col('source_url', 'Source URL', 'text', 'Link to the original document.'),
      col('text_chars', 'Text length', 'number', 'Character count of the retained text.'),
      col('full_text', 'Full text', 'longtext', 'The complete retained document text.'),
    ],
    build: buildArticlesFullText,
  },
  {
    slug: 'concepts',
    title: 'Concept scaffold',
    description:
      'The terminology dependency graph: every concept with its short definition, full explanation, settled or contested status, prerequisite concepts, and linked hypotheses.',
    methodology:
      'The learning path is the prerequisites column: understand those slugs before this one. The graph is kept acyclic by the writer. Hypothesis links are human-confirmed only.',
    category: 'argument-graph',
    formats: ['csv', 'json'],
    columns: [
      col('slug', 'Slug', 'text', 'Stable identifier; links to /concepts/<slug>.'),
      col('name', 'Name', 'text', 'Display name of the concept.'),
      col('short_definition', 'Short definition', 'text', 'One-sentence definition.'),
      col('explanation', 'Explanation', 'longtext', 'The full explainer prose.'),
      col('status', 'Status', 'enum', 'settled (broad agreement) or contested (live disagreement).'),
      col('prerequisites', 'Prerequisites', 'text', 'Concept slugs to understand first, joined with a semicolon.'),
      col('linked_hypotheses', 'Linked hypotheses', 'text', 'Hypothesis codes this concept underpins, joined with a semicolon.'),
    ],
    build: buildConcepts,
  },
  {
    slug: 'signals-by-hypothesis',
    title: 'Signals by hypothesis',
    description:
      'The touch matrix in long form: one row for every published signal that bears on every hypothesis it touches, with the direction of the touch. The dataset for direction-balance questions.',
    methodology:
      `Pivot hypothesis_code against direction to see the support and contradiction balance per hypothesis. ${PUBLISHED_NOTE} Direction comes from the evidence row the publish gate materialized; a blank direction means the touch never materialized.`,
    category: 'evidence',
    formats: ['csv', 'json'],
    columns: [
      col('hypothesis_code', 'Hypothesis code', 'text', 'Code of the touched hypothesis.'),
      col('hypothesis_statement', 'Hypothesis statement', 'longtext', 'Statement of the touched hypothesis.'),
      col('signal_id', 'Signal ID', 'text', 'The touching signal.'),
      col('signal_title', 'Signal title', 'text', 'Title of the touching signal.'),
      col('published_on', 'Published', 'date', 'Signal\'s editorial date (YYYY-MM-DD).'),
      col('significance', 'Significance', 'enum', 'high, medium, or low.'),
      col('context', 'Context', 'enum', 'internal or external.'),
      col('direction', 'Direction', 'enum', 'supports, contradicts, or neutral; blank when untracked.'),
    ],
    build: buildSignalsByHypothesis,
  },
  {
    slug: 'hypothesis-reports',
    title: 'Hypothesis reports',
    description:
      'The hypothesis scoreboard: every saved hypothesis report with its matched-signal counts, direction balance, one-sidedness and thin-coverage flags, and a link to the full public report.',
    methodology:
      'Each row reads the frozen, guest-safe stats pack of a saved report; the statement is frozen at generation time. one_sided and thin are the same caveat flags the report page itself shows.',
    category: 'meta',
    formats: ['csv', 'json'],
    columns: [
      col('report_id', 'Report ID', 'text', 'Stable UUID of the saved report.'),
      col('hypothesis_code', 'Hypothesis code', 'text', 'Code of the hypothesis the report runs on.'),
      col('hypothesis_statement', 'Hypothesis', 'longtext', 'The hypothesis as frozen at generation time.'),
      col('generated_on', 'Generated', 'date', 'When the report was generated (YYYY-MM-DD).'),
      col('signals_scanned', 'Scanned', 'number', 'Published signals in the corpus at generation time.'),
      col('signals_matched', 'Matched', 'number', 'Signals matched to the hypothesis.'),
      col('supporting', 'Supporting', 'number', 'Matched signals whose touches support the hypothesis.'),
      col('contradicting', 'Contradicting', 'number', 'Matched signals whose touches contradict.'),
      col('neutral', 'Neutral', 'number', 'Matched signals with neutral touches only.'),
      col('untyped', 'Untyped', 'number', 'Matched signals with no direction data.'),
      col('one_sided', 'One-sided', 'enum', 'yes when support exists with zero contradiction; a coverage warning, not a verdict.'),
      col('thin', 'Thin', 'enum', 'yes when fewer than five signals matched.'),
      col('first_matched', 'First matched', 'date', 'Earliest matched signal date.'),
      col('last_matched', 'Last matched', 'date', 'Latest matched signal date.'),
      col('report_url', 'Report URL', 'text', 'Public path of the full narrative report.'),
    ],
    build: buildHypothesisReports,
  },
  {
    slug: 'research-papers',
    title: 'Research papers',
    description:
      'The curated research shortlist: papers and long documents the library kept, with abstracts, triage summaries, and advisory hypothesis links.',
    methodology:
      'Kept papers only, never the raw funnel. touches here is advisory: papers do not write evidence; a paper enters the record only by promotion to a signal. The reviewer\'s private notes and priors are absent.',
    category: 'research',
    formats: ['csv', 'json'],
    columns: [
      col('title', 'Title', 'text', 'Paper title.'),
      col('url', 'URL', 'text', 'Link to the paper.'),
      col('abstract', 'Abstract', 'longtext', 'The paper\'s abstract.'),
      col('published_on', 'Published', 'date', 'Paper date (YYYY-MM-DD).'),
      col('triage_summary', 'Triage summary', 'longtext', 'Why the library kept it, in one paragraph.'),
      col('advisory_touches', 'Advisory touches', 'text', 'Hypothesis codes the paper may bear on; advisory only.'),
      col('suggested_concepts', 'Suggested concepts', 'text', 'Concept slugs the paper speaks to.'),
      col('promoted_signal_id', 'Promoted signal', 'text', 'Signal ID when the paper was promoted to the board.'),
    ],
    build: buildResearchPapers,
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
    col('category', 'Category', 'enum', 'argument-graph, signals, evidence, sources, research, or meta.'),
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

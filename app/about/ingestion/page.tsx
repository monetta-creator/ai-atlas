import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signal ingestion · The AI Atlas' };

const SECTIONS = [
  {
    id: 'standing-intake',
    heading: 'A standing intake of outside signal',
    body: 'Every weekday morning, before anyone opens the site, scheduled jobs sweep the outside world. Press feeds and news wires across a configurable set of topics. Targeted news search, through a model-free search API, for every tracked company and theme. Primary regulatory sources, including securities filings within a day of posting. Each item found is fetched in full text (a reader service stands in for hosts that block a direct fetch), deduplicated against everything already seen, and stored with its provenance: the source, the URL, the date, and how it was discovered. Where the fetch succeeds, the article, the filing, or the release itself is retained, not a paraphrase, with no retention limit today; an item whose host blocks fetching keeps its search summary and link.',
  },
  {
    id: 'structure',
    heading: 'Raw text becomes structured records',
    body: 'Each retained item is then read by a language model working under strict rules: write a short factual summary, tag the item against a fixed taxonomy, name the entities involved, link it to the tracked companies it concerns, score its significance, and extract the discrete facts it supports as one-sentence, dated, attributed statements. The model may only choose from controlled vocabularies. A tag, a company link, or a fact that falls outside the allow-list is dropped, not stored. What accumulates is not a pile of articles but three growing libraries: items with their full text, facts with their provenance, and the tags that make both searchable.',
  },
  {
    id: 'metrics',
    heading: 'The numbers layer',
    body: 'Alongside the text flows a metrics warehouse: roughly two million structured data points of quarterly history pulled straight from public regulatory and filing sources. The complete bank call-report field set for every tracked charter. Consolidated holding-company reports. Securities-filing financials. Consumer-complaint statistics. The history runs about a decade deep, every value keyed by company, metric, period, and source, and the recent periods refresh automatically as new data posts. No model touches this layer: the numbers are carried exactly as reported.',
  },
  {
    id: 'exports',
    heading: 'Built to travel',
    body: 'The point of collecting all of this is to move it somewhere it can be used. Everything publishes as versioned datasets with formal schemas: a column-by-column contract in JSON Schema, generated documentation that an intake system on the receiving side can read as its orientation, and stable identifiers (tickers, regulatory IDs, internal slugs) so records line up cleanly with internal and licensed datasets after import. The exports share a common row shape by design, so one importer, written once, ingests all of them.',
  },
  {
    id: 'discipline',
    heading: 'Metered, gated, auditable',
    body: 'Every model call and every search call is logged with its cost at the moment it happens, and daily budget caps sit in front of every billable step. The grunt work (summarizing, tagging, extraction, relevance scoring) runs on inexpensive open-weight models hosted on OpenRouter (Qwen, GLM, and DeepSeek flash-class models today), benchmarked against each other in live A/B splits; Claude models are reserved for the reasoning legs: dossiers, report narratives, deep dives, and the Ask answers. Nothing the models produce moves a confidence on the argument map; a confidence changes only when a human writes a reason. A signal reaches the board when a human publishes its draft, or when the promotion policy publishes a high-significance draft that touches a claim after a 48-hour window in which a human can archive it. The Daily Edition and the scheduled reports publish without a review step. And every run leaves a trail: day grids, health panels, per-run notes, so a quiet failure is a visible flag rather than a silent gap.',
  },
];

export default async function IngestionPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/ingestion"
        label="Signal ingestion"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.ingestion.title"
            value={txt('about.ingestion.title', 'Signal ingestion')}
            editing={editing}
          />
        }
      />
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.ingestion" txt={txt} />
    </>
  );
}

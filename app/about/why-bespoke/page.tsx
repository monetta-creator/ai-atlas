import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Why bespoke · The AI Atlas' };

const SECTIONS = [
  {
    id: 'chatbots',
    heading: 'Why not just ask a chatbot',
    body: 'A general chatbot answers from its training data plus, at best, a handful of live searches. It starts from zero every conversation: nothing accumulates, nothing is retained, and the same question next month redoes the same work with different results. This system inverts that. Collection is continuous and compounding: each day’s sweep lands in a permanent, deduplicated record with provenance, and a question asked today is answered from everything gathered so far, with citations back to the original documents. Chat is still an interface here, but it sits on top of a record rather than a memory.',
  },
  {
    id: 'provenance',
    heading: 'Answers you can check',
    body: 'Summaries never replace their sources: the full text stays attached to every item. Extracted facts carry a link to the document they came from and the date they are true as of. Generated narratives pass a citation gate that strips any link the underlying data cannot vouch for, and answers can be verified line by line against the record they claim to describe. That is the working difference between "the model says" and "the record shows", and it is the property general-purpose tools structurally cannot offer, because they keep no record to check against.',
  },
  {
    id: 'market',
    heading: 'Against commercial platforms',
    body: 'Commercial enterprise research platforms are genuinely good at what they license: transcripts, broker research, curated financial data. But they are one-size-fits-all by construction: their taxonomy, their schemas, their models, their per-seat pricing, and no say over what gets collected or how it is structured. This system covers the public-source half of that ground (news, filings, regulatory data, a deep structured metrics history) while being the opposite in shape: every layer is ours to change. It is also built to complement licensed platforms rather than replace them: exports carry standard identifiers precisely so licensed data can be joined on top downstream.',
  },
  {
    id: 'custom',
    heading: 'Customizable at every layer',
    body: (
      <ul>
        <li><strong>What to track</strong>: the company and topic registries are editable rows, not a vendor request.</li>
        <li><strong>What to ask</strong>: search queries are templates that rotate daily and can be rewritten in place.</li>
        <li><strong>What to tag</strong>: the taxonomy is an editorial decision, changed with a deploy, enforced by allow-lists.</li>
        <li><strong>Which models</strong>: enrichment models are a picker, split-tested live, with per-model quality and cost tracked side by side.</li>
        <li><strong>How much to spend</strong>: every stage sits behind a daily budget cap, and every call is metered.</li>
        <li><strong>What ships</strong>: datasets are registry-driven, so a new export is a schema declaration, not a project.</li>
      </ul>
    ),
  },
  {
    id: 'economics',
    heading: 'The economics',
    body: 'The entire daily ingestion runs for pennies. Search uses model-free APIs. Enrichment runs on inexpensive open-weight models that are benchmarked head to head, and frontier models are reserved for the few places judgment matters. Costs are priced at call time against a rate card and surfaced on the same consoles that show coverage, so the spend is as visible as the output. Changing focus (a new company, a new topic, a new export) is an edit measured in minutes, not a procurement cycle measured in quarters.',
  },
];

export default async function WhyBespokePage() {
  const { editing, txt } = await getEditContext();
  return (
    <>
      <header className="pagehead" style={{ paddingBottom: 16 }}>
        <Editable
          as="h1"
          k="about.whybespoke.title"
          value={txt('about.whybespoke.title', 'Why bespoke')}
          editing={editing}
        />
        <Editable
          as="p"
          className="lede"
          k="about.whybespoke.lede"
          value={txt(
            'about.whybespoke.lede',
            'What this does that a general chatbot cannot, where it stands against commercial enterprise research platforms, and why every layer of it is changeable.'
          )}
          editing={editing}
        />
      </header>
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.whybespoke" txt={txt} />
    </>
  );
}

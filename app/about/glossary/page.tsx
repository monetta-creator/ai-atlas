import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Glossary · The AI Atlas' };

const TERMS: { id: string; term: string; def: string }[] = [
  { id: 'question', term: 'Question', def: 'A neutral, open question that reasonable people disagree on. The top of the map.' },
  { id: 'stance', term: 'Stance', def: 'A candidate answer to a question, labeled with who actually holds it.' },
  { id: 'claim', term: 'Claim', def: 'A specific, checkable statement a stance rests on. Must carry a test.' },
  { id: 'test', term: 'Test', def: 'What would have to be true to stop believing a claim. Required.' },
  { id: 'frame', term: 'Frame', def: 'An organizing belief that is not itself falsifiable. Stored and labeled, kept out of evidence.' },
  { id: 'domain', term: 'Domain', def: 'The single area a claim belongs to: capability, economics, build-out, market, or labor. Evidence in one cannot quietly move another.' },
  { id: 'bridge-claim', term: 'Bridge-claim', def: 'A first-class claim about the link between two domains, with its own test.' },
  { id: 'evidence', term: 'Evidence', def: 'A finding attached to a claim or bridge, marked supporting, contradicting, or neutral. Carries its provenance: a source, a signal, or both.' },
  { id: 'source', term: 'Source', def: 'An article, paper, or document evidence is drawn from. Carries an AI-written dossier and a maintainer-set reliability rating (0 to 100; the AI never sets it).' },
  { id: 'confidence', term: 'Confidence', def: 'How strongly the maintainer holds a claim, 0 to 1, shown as a word: thin, contested, leaning, or settled. Private.' },
  { id: 'rationale', term: 'Rationale', def: 'The short reason recorded on every confidence move. Required, never edited after.' },
  { id: 'reflexive', term: 'Reflexive', def: 'A flag for a claim whose truth is partly caused by belief in it.' },
  { id: 'personal-layer', term: 'Personal layer', def: 'The author’s confidences, rationales, source ratings, and positions. Stripped server-side for guests.' },
  { id: 'share-view', term: 'Share view', def: 'Guest mode: the public map with the personal layer hidden. There is no separate renderer.' },
  { id: 'signal', term: 'Signal', def: 'One tracked development on the Signal Board: title, summary, lenses, and the claims or bridges it touches. Drafts are admin-only; publishing, by a human or by the promotion policy, writes the evidence rows.' },
  { id: 'signal-lens', term: 'Signal lens', def: 'The audience angle a signal is filed under: market, labor, geopolitics, regulatory, capability, or society.' },
  { id: 'discovery-pipeline', term: 'Discovery pipeline', def: 'The flow that feeds the Signal Board: search, triage, analysis, review. Runs on weekday crons and produces drafts; a human publishes them, or the promotion policy does.' },
  { id: 'promotion-policy', term: 'Promotion policy', def: 'The rule that publishes a high-significance pipeline draft that touches at least one claim after a 48-hour window in which a human can archive it. Archiving is the veto; the publish writes evidence like any other.' },
  { id: 'engine', term: 'Collection engine', def: 'One of the scheduled sweeps that feed the corpus: the news scan, the discovery pipeline, company intel, arXiv research, and the weekly tooling scan. Each runs on weekday crons, checkpoints its run in the database, and stops at a budget cap.' },
  { id: 'edition', term: 'Daily Edition', def: 'The News Blotter’s weekday paper, written by a model from what the engines stored that day and published on schedule. Every link in it must be in the day’s records.' },
  { id: 'touch', term: 'Touch', def: 'The link between a signal and a claim or bridge, with a direction and reason. Becomes one evidence row on publish.' },
  { id: 'concept', term: 'Concept', def: 'One term in the AI vocabulary, marked settled or contested, wired into an acyclic prerequisite graph: understand the lower ones first.' },
  { id: 'thread', term: 'Research thread', def: 'A living synthesis of what the recent literature says on one question, revised as tracked papers land.' },
  { id: 'paper', term: 'Paper', def: 'One item in the research library, staged through triage and review. Paper findings are advisory; they never write evidence.' },
  { id: 'scout', term: 'Startup Scout', def: 'The funnel of tracked young AI companies: discovered by vertical, scored recommend-only against an editable rubric, and tracked by the maintainer. Verdicts and scores are private.' },
  { id: 'vertical', term: 'Vertical', def: 'One slice of the scout’s search (fintech, enterprise workflows, process automation, ...), carrying its own discovery queries.' },
  { id: 'report', term: 'Report', def: 'A generated, citation-gated document: a period report, tear sheet, briefing, roundup, tooling report, thesis report, or the daily edition, downloadable as a PDF. Most publish by hand; the daily edition, the Friday research roundup, and the Monday tooling entrants report publish on schedule.' },
  { id: 'citation-gate', term: 'Citation gate', def: 'The check that strips any generated citation the underlying data pack cannot vouch for. Runs at generation, save, and render.' },
  { id: 'human-gate', term: 'Human gate', def: 'The rule that no confidence changes without a person: confidences move by hand with a reason, recommendations are accepted by hand, and signal drafts publish by hand or, for high-significance pipeline drafts that touch a claim, by the promotion policy after its 48-hour veto window.' },
  { id: 'access-key', term: 'Access key', def: 'The per-person key, issued by the maintainer on request and expiring after 90 days, that unlocks the portal tier: Ask, the key-gated datasets with retained text and machine-extracted records, tooling reports, and Scout’s research tools. Guests without one see the public layer.' },
];

export default async function GlossaryPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/glossary"
        label="Glossary"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.glossary.title"
            value={txt('about.glossary.title', 'Glossary')}
            editing={editing}
          />
        }
      />

      <div style={{ maxWidth: '68ch' }}>
        {TERMS.map((t) => (
          <div className="dclaim" key={t.id}>
            <Editable
              as="span"
              className="df"
              k={`glossary.term.${t.id}.term`}
              value={txt(`glossary.term.${t.id}.term`, t.term)}
              editing={editing}
            />
            <Editable
              as="span"
              className="dv"
              multiline
              k={`glossary.term.${t.id}.def`}
              value={txt(`glossary.term.${t.id}.def`, t.def)}
              editing={editing}
            />
          </div>
        ))}
      </div>
    </>
  );
}

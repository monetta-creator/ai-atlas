import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

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
  { id: 'source', term: 'Source', def: 'An article, paper, or document evidence is drawn from. Carries an AI-written dossier and an author-set reliability rating (0 to 100; the AI never sets it).' },
  { id: 'confidence', term: 'Confidence', def: 'How strongly the author holds a claim, 0 to 1, shown as a word: thin, contested, leaning, or settled. Private.' },
  { id: 'rationale', term: 'Rationale', def: 'The short reason recorded on every confidence move. Required, never edited after.' },
  { id: 'reflexive', term: 'Reflexive', def: 'A flag for a claim whose truth is partly caused by belief in it.' },
  { id: 'personal-layer', term: 'Personal layer', def: 'The author’s confidences, rationales, source ratings, and positions. Stripped server-side for guests.' },
  { id: 'share-view', term: 'Share view', def: 'Guest mode: the public map with the personal layer hidden. There is no separate renderer.' },
  { id: 'signal', term: 'Signal', def: 'One tracked development on the Signal Board: title, summary, lenses, and the claims or bridges it touches. Drafts are author-only; publishing writes the evidence rows.' },
  { id: 'signal-lens', term: 'Signal lens', def: 'The audience angle a signal is filed under: market, labor, geopolitics, regulatory, capability, or society.' },
  { id: 'discovery-pipeline', term: 'Discovery pipeline', def: 'The flow that feeds the Signal Board: web discovery, triage, analysis, human review. Only ever produces drafts.' },
  { id: 'touch', term: 'Touch', def: 'The link between a signal and a claim or bridge, with a direction and reason. Becomes one evidence row on publish.' },
  { id: 'concept', term: 'Concept', def: 'One term in the AI vocabulary, marked settled or contested, wired into an acyclic prerequisite graph: understand the lower ones first.' },
  { id: 'thread', term: 'Research thread', def: 'A living synthesis of what the recent literature says on one question, revised as tracked papers land.' },
  { id: 'paper', term: 'Paper', def: 'One item in the research library, staged through triage and review. Paper findings are advisory; they never write evidence.' },
  { id: 'report', term: 'Report', def: 'A generated, citation-gated document: a period report, tear sheet, briefing, or thesis report, published by the author and downloadable as a PDF.' },
  { id: 'citation-gate', term: 'Citation gate', def: 'The check that strips any generated citation the underlying data pack cannot vouch for. Runs at generation, save, and render.' },
  { id: 'human-gate', term: 'Human gate', def: 'The rule that no value changes without a person: confidences move by hand with a reason, drafts publish by hand, recommendations are accepted by hand.' },
];

export default async function GlossaryPage() {
  const { editing, txt } = await getEditContext();
  return (
    <>
      <header className="pagehead" style={{ paddingBottom: 16 }}>
        <Editable
          as="h1"
          k="about.glossary.title"
          value={txt('about.glossary.title', 'Glossary')}
          editing={editing}
        />
      </header>

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

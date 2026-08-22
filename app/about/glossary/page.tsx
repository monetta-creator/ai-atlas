import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Glossary · The Strategy Atlas' };

const TERMS: { id: string; term: string; def: string }[] = [
  { id: 'hypothesis', term: 'Hypothesis', def: 'A falsifiable statement the strategy leans on, with a stable code (H1, H2, ...). The top-line object of the board.' },
  { id: 'test', term: 'Test', def: 'What would have to be true to stop believing a hypothesis. Required.' },
  { id: 'conviction', term: 'Conviction', def: 'How strongly the team holds a hypothesis, 0 to 1, shown as a word: thin, contested, leaning, or settled. Private; moves only with a rationale.' },
  { id: 'confidence', term: 'Confidence', def: 'The weight on one evidence link: high, medium, or low. How much this piece of evidence should count, set by the operator.' },
  { id: 'evidence', term: 'Evidence', def: 'A finding attached to a hypothesis, marked supporting, contradicting, or neutral. Carries its provenance: a source, a signal, or both.' },
  { id: 'source', term: 'Source', def: 'An article, paper, or document evidence is drawn from. Carries an AI-written dossier and an operator-set reliability rating (0 to 100; the AI never sets it).' },
  { id: 'rationale', term: 'Rationale', def: 'The short reason recorded on every conviction move. Required, never edited after.' },
  { id: 'personal-layer', term: 'Personal layer', def: 'The operator\u2019s convictions, rationales, and source ratings. Stripped server-side for guests.' },
  { id: 'share-view', term: 'Share view', def: 'Guest mode: the public board with the personal layer hidden. There is no separate renderer.' },
  { id: 'signal', term: 'Signal', def: 'One tracked development on the Signal Board: title, summary, context, and the hypotheses it touches. Drafts are operator-only; publishing writes the evidence rows.' },
  { id: 'context', term: 'Context', def: 'Where a signal comes from: internal (inside the organization) or external (the outside world).' },
  { id: 'intake', term: 'Intake', def: 'The flow that feeds the Signal Board: a document enters by hand, is triaged and analyzed, and a human reviews the draft. Only ever produces drafts.' },
  { id: 'touch', term: 'Touch', def: 'The link between a signal and a hypothesis, with a direction and reason. Becomes one evidence row on publish.' },
  { id: 'hypothesis-link', term: 'Hypothesis link', def: 'A relation between two hypotheses, usually a narrower one promoted out of a gap scan on a broader one.' },
  { id: 'gap-scan', term: 'Gap scan', def: 'A recommend-only diagnosis of hypotheses the recent evidence demands but the board lacks. Creating from it is an explicit human commit.' },
  { id: 'concept', term: 'Concept', def: 'One term in the working vocabulary, marked settled or contested, wired into an acyclic prerequisite graph: understand the lower ones first.' },
  { id: 'thread', term: 'Research thread', def: 'A living synthesis of what the tracked literature says on one question, revised as papers land.' },
  { id: 'paper', term: 'Paper', def: 'One item in the research library, staged through triage and review. Paper findings are advisory; they never write evidence.' },
  { id: 'report', term: 'Report', def: 'A generated, citation-gated document: a period report or a hypothesis report, published by the operator and downloadable as a PDF.' },
  { id: 'citation-gate', term: 'Citation gate', def: 'The check that strips any generated citation the underlying data pack cannot vouch for. Runs at generation, save, and render.' },
  { id: 'human-gate', term: 'Human gate', def: 'The rule that no value changes without a person: convictions move by hand with a reason, drafts publish by hand, recommendations are accepted by hand.' },
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

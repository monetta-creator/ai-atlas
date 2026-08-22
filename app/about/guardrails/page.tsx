import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guardrails · The Strategy Atlas' };

const SECTIONS = [
  {
    id: 'test',
    heading: 'Every hypothesis carries a test',
    body: 'A hypothesis only counts if it says what would make it false. The schema enforces this: a hypothesis cannot be created without a test. A statement with no test is not a hypothesis. Without this rule, the Atlas would become a board where nothing can ever be wrong.',
  },
  {
    id: 'links',
    heading: 'Links between hypotheses are explicit',
    body: 'When one hypothesis really bears on another, the link is recorded as its own object, usually by promoting a narrower hypothesis out of a broader one and linking the two. Nothing implies anything in passing: each hypothesis carries its own test and its own evidence.',
  },
  {
    id: 'disconfirming',
    heading: 'Disconfirming evidence counts equally',
    body: (
      <>
        <p>
          Evidence is recorded as supporting or contradicting, and both count the same. When a hypothesis’s
          evidence all points one way, the page flags it. The flag is a prompt to go find the other
          side, not a verdict:
        </p>
        <div
          style={{
            border: '1px solid var(--heat-4)',
            color: 'var(--heat-4)',
            borderRadius: 'var(--radius)',
            padding: '10px 14px',
            fontSize: 13,
            lineHeight: 1.5,
            marginTop: 12,
          }}
        >
          ⚠ One-sided. All evidence points the same way.
        </div>
      </>
    ),
  },
  {
    id: 'model-proposes',
    heading: 'The model proposes, the human commits',
    body: 'The AI suggests and never commits. It never sets how far a source is trusted, never writes evidence, and never moves a conviction. The operator changes every number by hand with a short reason, saved together and never edited later. The same rule runs everywhere: intake only ever creates drafts, the research queue agent stamps recommendations a human accepts or ignores, and the gap diagnoses argue for missing hypotheses that only an explicit human commit creates.',
  },
  {
    id: 'citation-gate',
    heading: 'The citation gate',
    body: 'Every generated narrative is drafted over a frozen data pack computed from the database first. Before the prose ships, every link in it is checked against that pack: a citation the pack cannot vouch for is stripped and the drop recorded, never silently kept. The check runs at generation, at save, and again at render, so an edited or stale report cannot smuggle a link back in.',
  },
  {
    id: 'verification',
    heading: 'Answers are checked against the record',
    body: 'Deep-research answers get a two-layer faithfulness check before they finish: a deterministic pass (quoted spans and figures must literally appear in the gathered material) and a model pass judging each statement against the same material. Quick answers get the same check on demand. Problems are flagged to the reader, never silently corrected.',
  },
  {
    id: 'defaults',
    heading: 'Defaults to react against',
    body: 'Every hypothesis starts at the midpoint, which the team then has to move. A proposed hypothesis, however plausible, enters neutral on purpose. The rule is to take the structure and form independent conclusions.',
  },
  {
    id: 'blocks',
    heading: 'What this blocks',
    body: (
      <ul>
        <li><strong>The conspiracy board</strong>, where nothing can be disconfirmed. (Test required.)</li>
        <li><strong>The auto-updating belief tracker</strong>, where numbers drift without a person and a reason. (The human gate.)</li>
        <li><strong>The confident summarizer</strong>, where generated prose drifts away from the record it claims to describe. (The citation gate, plus answer verification.)</li>
        <li><strong>The proof engine</strong>, with a score to maximize and a thesis to defend. (The board orients rather than proves, and defaults must be moved by hand.)</li>
      </ul>
    ),
  },
];

export default async function GuardrailsPage() {
  const { editing, txt } = await getEditContext();
  return (
    <>
      <header className="pagehead" style={{ paddingBottom: 16 }}>
        <Editable
          as="h1"
          k="about.guardrails.title"
          value={txt('about.guardrails.title', 'Guardrails')}
          editing={editing}
        />
      </header>
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.guardrails" txt={txt} />
    </>
  );
}

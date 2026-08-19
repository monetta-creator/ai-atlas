import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Guardrails · The AI Atlas' };

const SECTIONS = [
  {
    id: 'test',
    heading: 'Every claim carries a test',
    body: 'A claim only counts if it says what would make it false. The schema enforces this: a claim must have a test unless it is tagged a frame. A statement with no test is not a claim. It gets stored as a frame and cannot collect supporting evidence. Without it, the Atlas would become a board where nothing can ever be wrong.',
  },
  {
    id: 'firewall',
    heading: 'The domain firewall',
    body: 'Every claim belongs to exactly one domain: capability, economics, build-out, market, or labor. A finance finding cannot quietly move a capability claim. A common move in this debate is to let a “no” in one domain imply “no” everywhere. Keeping the domains separate makes that move visible instead of silent.',
  },
  {
    id: 'bridges',
    heading: 'Bridge-claims make the leap explicit',
    body: 'Sometimes one domain really does bear on another. Those links are not banned, they are pulled out. A bridge-claim names the two domains it connects, carries its own test, and is shown on its own. So a claim like “capability gains will become enterprise revenue” has to be stated and tested in the open, instead of assumed in passing.',
  },
  {
    id: 'disconfirming',
    heading: 'Disconfirming evidence counts equally',
    body: (
      <>
        <p>
          Evidence is recorded as supporting or contradicting, and both count the same. When a claim’s
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
    body: 'The AI suggests and never commits. It never sets how far a source is trusted, never writes evidence, and never moves a confidence. The author changes every number by hand with a short reason, saved together and never edited later. The same rule runs everywhere: the discovery pipeline and the scout only ever create drafts and queue rows, the queue agents stamp recommendations a human accepts or ignores, and the gap diagnoses argue for missing nodes without creating them. Where the AI touches the live web (discovery, scout discovery, the Ask web toggle), the output is a draft, a queue entry, or an answer with its sources shown, never a write to the map.',
  },
  {
    id: 'learning-loop',
    heading: 'The pipeline learns where to look, not what to believe',
    body: 'The discovery pipeline keeps a track record of its own searches. Domains that never yield a draft get blocked from future discovery, domains that block fetching get routed straight through a reader service, and triage sees each domain’s history. That feedback changes where the model looks next, and nothing else. It never touches a claim, a confidence, or a piece of evidence.',
  },
  {
    id: 'citation-gate',
    heading: 'The citation gate',
    body: 'Every generated narrative is drafted over a frozen data pack computed from the database first. Before the prose ships, every link in it is checked against that pack: a citation the pack cannot vouch for is stripped and the drop recorded, never silently kept. The check runs at generation, at save, and again at render, so an edited or stale report cannot smuggle a link back in.',
  },
  {
    id: 'verification',
    heading: 'Answers are checked against the record',
    body: 'Deep-research answers get a two-layer faithfulness check before they finish: a deterministic pass (quoted spans and figures must literally appear in the gathered material) and a model pass judging each statement against the same material. Quick answers get the same check on demand. Problems are flagged to the reader, never silently corrected. Web-informed answers are the exception: their web facts sit outside the corpus, so they carry their sources instead of the Atlas check.',
  },
  {
    id: 'defaults',
    heading: 'Defaults to react against',
    body: 'When the map is seeded, every confidence starts at the midpoint, which the author then has to move. The structure of the map came from an outside reviewer, but their confidence levels were thrown out on purpose. The rule is to take the structure and form independent conclusions.',
  },
  {
    id: 'blocks',
    heading: 'What this blocks',
    body: (
      <ul>
        <li><strong>The conspiracy board</strong>, where nothing can be disconfirmed. (Test required, frames kept out of evidence.)</li>
        <li><strong>Cross-domain contamination</strong>, where a finding in one domain quietly moves another. (The firewall, plus explicit bridge-claims.)</li>
        <li><strong>The auto-updating belief tracker</strong>, where numbers drift without a person and a reason. (The human gate.)</li>
        <li><strong>The confident summarizer</strong>, where generated prose drifts away from the record it claims to describe. (The citation gate, plus answer verification.)</li>
        <li><strong>The proof engine</strong>, with a score to maximize and a thesis to defend. (The map orients rather than proves, and defaults must be moved by hand.)</li>
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

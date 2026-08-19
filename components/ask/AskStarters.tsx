'use client';

import ExamplePill from '@/components/ask/ExamplePill';

// The empty-state hero: headline face title, one grounding line, and the
// typing example pill (the lobby launcher's idiom, replacing the old labeled
// starter card grid). Picking the pill's question submits it as the
// conversation's first turn (or, when the workspace is locked, focuses the
// unlock key input instead, handled upstream).
export default function AskStarters({
  onPick, locked,
}: {
  onPick: (question: string) => void;
  locked: boolean;
}) {
  return (
    <div className="ask-hero">
      <h1>Ask the Atlas</h1>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', maxWidth: 560, margin: 0 }}>
        Grounded answers over everything the Atlas tracks: signals, claims and their evidence,
        concepts, theses, and the retained article text. Every reference is cited and links back
        to its record{locked ? '. Unlock below with the team key to start.' : '.'}
      </p>
      <ExamplePill onPick={onPick} />
    </div>
  );
}

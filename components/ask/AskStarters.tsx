'use client';

// The empty-state hero: the title only. The composer sits right under it,
// mid-page, and the "what is moving" tabs follow (AskTrending, rendered by
// AskWorkspace). The grounding paragraph, the typing example pill and the
// "Where do I start?" link moved out on 2026-11-12 (the link now heads the
// tabs). Locked visitors see the unlock panel where the composer sits.
export default function AskStarters() {
  return (
    <div className="ask-hero">
      <h1>Ask the Atlas</h1>
    </div>
  );
}

'use client';

// The empty-state hero: the title only. The composer sits right under it,
// mid-page, and the "what is moving" tabs follow (AskTrending, rendered by
// AskWorkspace). The grounding paragraph, the typing example pill and the
// "Where do I start?" link moved out on 2026-11-12 (the link now heads the
// tabs). Locked visitors see the unlock panel where the composer sits. On
// phones the tabs are hidden and the Atlas mark sits over the title.
export default function AskStarters() {
  return (
    <div className="ask-hero">
      <svg className="ask-hero-mark" width="40" height="40" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" />
      </svg>
      <h1>Ask the Atlas</h1>
    </div>
  );
}

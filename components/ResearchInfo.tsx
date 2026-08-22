'use client';

import { useEffect, useState } from 'react';

// The page's descriptive prose, condensed behind an "i" button: what
// the funnel does, how the three decisions work, and how to read the quality
// signals (h-max scale included). Plain overlay dialog: Escape / outside-click /
// button all close it.
export default function ResearchInfo() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const h = { fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--faint-ink)', margin: '14px 0 4px' };
  const p = { fontSize: 13.5, lineHeight: 1.65, color: 'var(--dim)', margin: '0 0 6px' };

  return (
    <>
      <button
        type="button"
        className="touch-chip"
        aria-label="How this page works"
        onClick={() => setOpen(true)}
        style={{
          cursor: 'pointer',
          fontSize: 12,
          padding: '5px 13px',
          borderStyle: 'dashed',
          borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--line))',
          color: 'var(--accent)',
        }}
      >
        ⓘ How this works
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="About the research page"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', padding: 'var(--card-pad)',
              maxWidth: 640, width: '100%', maxHeight: '82vh', overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <h2 style={{ fontSize: 16, margin: 0, color: 'var(--ink)' }}>How the Research section works</h2>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)} autoFocus>
                Close
              </button>
            </div>

            <div style={h}>What this is</div>
            <p style={p}>
              The arXiv intake: pull → triage → review. Runs are manual only (nothing is scheduled;
              cost at rest is zero). A pull lists new cs.AI / cs.LG / cs.CL submissions for the chosen
              lookback; triage reads each title + abstract against the Atlas&rsquo;s claims, concepts, and
              threads and keeps the few percent that genuinely bear on the tracked hypotheses. Nothing
              here writes evidence: promotion to a signal, and publishing it, is the only road into the
              Argument Map.
            </p>

            <div style={h}>The three decisions</div>
            <p style={p}>
              <strong>Track</strong>: this tests my picture. Requires a one-line why, joins the watchlist,
              and is the candidate set for Analyze, thread placement, and promotion. Citation refresh
              watches tracked papers.
            </p>
            <p style={p}>
              <strong>Note</strong>: worth remembering, no active attention. Filed under Noted.
            </p>
            <p style={p}>
              <strong>Dismiss</strong>: not relevant. Leaves the queue but keeps its metadata row, so
              rising citations can resurface it later (&ldquo;rising outside the funnel&rdquo;).
            </p>

            <div style={h}>Reading the quality signals</div>
            <p style={p}>
              <strong>h-max</strong> is the highest h-index among the paper&rsquo;s authors (Semantic
              Scholar). An h-index of n means the author has n papers cited at least n times each, so it
              measures track record, not this paper. Rough scale:
            </p>
            <p style={{ ...p, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
              0–4 &nbsp;no visible track record, or the authors of a very fresh paper are not yet linked
              <br />5–19 &nbsp;working researchers with a real publication record
              <br />20–39 &nbsp;established, likely a serious group (shown green from 20)
              <br />40+ &nbsp;leading figures in the field
            </p>
            <p style={p}>
              A prior, not a verdict: newcomers write great papers, and lab reports published under
              group names can score low. It fills in on later refreshes as Semantic Scholar links authors.
            </p>
            <p style={p}>
              The other two signals on a row: an <span style={{ color: 'var(--heat-2)' }}>orange comment</span>{' '}
              is the paper&rsquo;s own venue note (&ldquo;Accepted at NeurIPS&rdquo; is the strongest signal when
              present), and <strong>N×</strong> is the citation count, refreshed on demand from the
              watchlist section, lagging but confirming.
            </p>

            <div style={h}>Costs</div>
            <p style={p}>
              Triage is roughly a dollar per 1,000 abstracts; the per-paper Analyze click is ~$0.10;
              pulls, citation refreshes, and h-max lookups are free. Everything is metered on /costs.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

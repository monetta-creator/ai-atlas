'use client';

import { useEffect, useState } from 'react';

// The hub's explainer behind a small round "i" button beside the title:
// what the monitor is, how a product reaches the catalog, how to read a
// card, who sees what, and where the reports come from. Same plain overlay
// idiom as ResearchInfo / FeedbackDialog (Escape, backdrop, close button),
// styled with the shared .fb-overlay / .fb-card classes.
export default function ToolingInfo() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="tl-info-btn"
        aria-label="About this page"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="About this page"
        onClick={() => setOpen(true)}
      >
        i
      </button>

      {open && (
        <div className="fb-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="fb-card tl-info-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tl-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="btn btn--quiet btn--sm fb-close" onClick={() => setOpen(false)} autoFocus aria-label="Close">
              ✕
            </button>
            <p className="fb-kicker">AI Tooling Monitor</p>
            <h2 id="tl-info-title" className="fb-title">How this page works</h2>
            <p className="fb-sub">
              A weekly scan of the AI tool market for a transformation team at a regulated
              financial-services company. It answers four questions: what is on the market, how the
              market dimensionalizes, who just entered, and whether to build or buy.
            </p>

            <div className="tl-info-h">How a product gets here</div>
            <p className="tl-info-p">
              Every Monday the engine sweeps news search, Hacker News, GitHub, and vendor feeds for
              each category, extracts distinct products, reads each homepage, and fills a structured
              fact sheet: deployment, pricing, maturity, target buyers, compliance claims, features.
              A rubric written for this team then scores fit from 0 to 100. At or above the catalog
              threshold a product is cataloged and appears below; under it, or when the homepage
              never fetched, it is held for human review. Human decisions are sticky: the agent never
              demotes a cataloged product and never rescores a pinned one.
            </p>

            <div className="tl-info-h">Reading a card</div>
            <p className="tl-info-p">
              Name and vendor, a one-line description, then maturity, deployment model, pricing model,
              and <strong>first seen</strong>, the date the scanner found it (not the founding date).
              The tags are features named in the product&apos;s own material. Team keyholders also see the
              fit band (Strong, Solid, Marginal, Weak), the agent&apos;s rubric score, which is
              recommend-only.
            </p>

            <div className="tl-info-h">New this week</div>
            <p className="tl-info-p">
              Products cataloged in the last seven days. Each Monday run also writes the new-entrants
              report, which publishes automatically and is linked beside the strip.
            </p>

            <div className="tl-info-h">Who sees what</div>
            <p className="tl-info-p">
              Guests see the catalog: facts, features, the model-written dossier, timelines, and
              published reports. Team keyholders also see held products, the agent read, and deep
              dives, and can add a product or generate a report. The console (engine runs, categories,
              curation, datasets) is admin only.
            </p>

            <div className="tl-info-h">Reports</div>
            <p className="tl-info-p">
              Four kinds, all grounded in the catalog and cited back to it: the weekly new entrants,
              a category landscape, a build-or-buy brief for a capability, and a feature sheet across a
              category. Everything is downloadable as a branded PDF from the Report Portal.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

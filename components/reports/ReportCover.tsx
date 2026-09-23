import type { ReportCard } from "@/lib/reports/cards";

// A CSS miniature of the branded PDF cover (lib/pdf/shell.tsx PdfCover):
// wordmark, double rule, kicker, title, subject, meta lines, footer
// boilerplate. Paper-white in both themes on purpose, since it previews a
// PDF page rather than a themed UI surface. No hooks, no client directive:
// this is pure markup driven by the card.
export default function ReportCover({ card }: { card: ReportCard }) {
  if (card.family === 'deck') return <DeckCover card={card} />;
  return (
    <div
      className="rp-cover"
      data-kind={card.kind}
      data-draft={!card.isPublished || undefined}
      aria-hidden="true"
    >
      <div className="rp-cover-page">
        <div className="rp-cover-wordmark">THE AI ATLAS</div>
        <div className="rp-cover-rule">
          <i />
          <i />
        </div>
        <div className="rp-cover-kicker">{card.kindLabel}</div>
        <div className="rp-cover-title">{card.title}</div>
        {card.subject && <div className="rp-cover-subject">{card.subject}</div>}
        <div className="rp-cover-meta">
          {card.metaLines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
        <div className="rp-cover-foot">
          Generated from the AI Atlas corpus: tracked signals, falsifiable
          claims, and the evidence wiring them together. Every citation in this
          report resolves to a tracked record.
        </div>
        {!card.isPublished && <div className="rp-cover-ribbon">Draft</div>}
      </div>
    </div>
  );
}

// The deck variant: a 16:9 title slide (kicker, Anton headline, subtitle,
// slide-number strip) on a dark stage frame, so a deck reads as a different
// object from the A4 report covers around it.
function DeckCover({ card }: { card: ReportCard }) {
  return (
    <div className="rp-cover rp-cover--deck" data-kind="deck" aria-hidden="true">
      <div className="rp-cover-page rp-deck-slide">
        <div className="rp-deck-kicker">{card.metaLines[0]}</div>
        <div className="rp-deck-title">{card.title}</div>
        <div className="rp-deck-subtitle">{card.subject}</div>
        <div className="rp-deck-foot">
          <span>THE AI ATLAS</span>
          <span>{card.metaLines[1]}</span>
        </div>
      </div>
      <div className="rp-deck-tag">16:9 deck{card.access === 'admin' ? ' · admin' : ''}</div>
    </div>
  );
}


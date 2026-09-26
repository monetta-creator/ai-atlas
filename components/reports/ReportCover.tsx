import { Sacramento } from "next/font/google";
import type { ReportCard } from "@/lib/reports/cards";

// The Savant imprint's script signature for its cover card; the /savant
// subtree loads the same face for its masthead (next/font dedupes it).
const sacramento = Sacramento({ weight: "400", subsets: ["latin"], display: "swap" });

// A CSS miniature of the branded PDF cover (lib/pdf/shell.tsx PdfCover):
// wordmark, double rule, kicker, title, subject, meta lines, footer
// boilerplate. Paper-white in both themes on purpose, since it previews a
// PDF page rather than a themed UI surface. No hooks, no client directive:
// this is pure markup driven by the card.
export default function ReportCover({ card }: { card: ReportCard }) {
  if (card.family === 'deck') return <DeckCover card={card} />;
  if (card.kind === 'savant') return <SavantCover card={card} />;
  if (card.kind === 'intel_deck') return <IntelDeckCover card={card} />;
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


// The Savant variant: a miniature of its cobalt PDF cover (lib/pdf/savant-doc.tsx),
// the wordmark and script signature, the issue number and week large, the
// lead's title as the need-to-know line, and the colophon band. The dot
// grid and arcs are CSS, so the card costs no image.
function SavantCover({ card }: { card: ReportCard }) {
  const issue = card.metaLines[0] ?? 'Issue';
  const no = issue.replace(/^Issue\s*/i, '') || '1';
  return (
    <div className="rp-cover rp-cover--savant" data-kind="savant" data-draft={!card.isPublished || undefined} aria-hidden="true">
      <div className="rp-cover-page rp-sv">
        <i className="rp-sv-arc rp-sv-arc-1" />
        <i className="rp-sv-arc rp-sv-arc-2" />
        <i className="rp-sv-arc rp-sv-arc-3" />
        <div className="rp-sv-wordmark">THE AI ATLAS</div>
        <div className={`rp-sv-signature ${sacramento.className}`}>Savant</div>
        <div className="rp-sv-strap">An autonomous research agent with an editorial point of view.</div>
        <div className="rp-sv-issue">
          <span className="rp-sv-kicker">ISSUE</span>
          <span className="rp-sv-no">{no}</span>
          <span className="rp-sv-week">{card.subject}</span>
        </div>
        <div className="rp-sv-lead">
          <span className="rp-sv-kicker">THIS WEEK&rsquo;S LEAD</span>
          <span className="rp-sv-title">{card.title}</span>
        </div>
        <div className="rp-sv-band">Written by Savant, reviewed by an independent editor. For access-key holders.</div>
        {!card.isPublished && <div className="rp-cover-ribbon">Draft</div>}
      </div>
    </div>
  );
}

// The company intel deck is a 16:9 deck, not a sheet, so its card is the
// deck stage: a dark slide (the deck's own chrome, inverted from the guide
// decks' white slide) with the date large and the front's headline under it.
function IntelDeckCover({ card }: { card: ReportCard }) {
  return (
    <div className="rp-cover rp-cover--deck rp-cover--intel" data-kind="intel_deck" data-draft={!card.isPublished || undefined} aria-hidden="true">
      <div className="rp-cover-page rp-deck-slide rp-intel-slide">
        <div className="rp-deck-kicker">Company intel deck</div>
        <div className="rp-intel-date">{card.subject}</div>
        <div className="rp-intel-title">{card.title}</div>
        <div className="rp-intel-chips">
          {card.chips.slice(0, 3).map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="rp-deck-foot">
          <span>THE AI ATLAS</span>
          <span>WEEKDAY · KEYHOLDERS</span>
        </div>
      </div>
      <div className="rp-deck-tag">16:9 deck · keyholders</div>
    </div>
  );
}

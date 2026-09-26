// The Daily Edition's PDF download links. Server-safe (no client JS needed
// for a plain download): plain anchors to the day's Route Handlers. The
// newspaper PDF (a branded print of this read view) is the primary format;
// the 16:9 deck is kept as a secondary format at /deck/pdf. Used on both
// /blotter (latest) and /blotter/[day] (archive).
export default function EditionPdfButton({ day }: { day: string }) {
  return (
    <span className="flex items-center gap-2">
      <a className="btn btn--sm" href={`/blotter/${day}/pdf`}>
        Newspaper PDF
      </a>
      <a className="btn btn--ghost btn--sm" href={`/blotter/${day}/deck/pdf`}>
        Deck
      </a>
    </span>
  );
}

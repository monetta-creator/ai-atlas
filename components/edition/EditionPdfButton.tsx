// The Daily Edition's deck-PDF download link. Server-safe (no client JS
// needed for a plain download): a normal anchor to the day's Route Handler,
// which streams a 16:9 branded PDF. Used on both /blotter (latest) and
// /blotter/[day] (archive).
export default function EditionPdfButton({ day }: { day: string }) {
  return (
    <a className="btn btn--ghost btn--sm" href={`/blotter/${day}/pdf`}>
      Deck PDF
    </a>
  );
}

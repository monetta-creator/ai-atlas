// A plain download link to the issue's branded PDF (Letter, script-signed
// cover). No client JS needed for a same-origin download, same idiom as
// EditionPdfButton.
export default function SavantPdfButton({ week }: { week: string }) {
  return (
    <a className="btn btn--sm" href={`/savant/${week}/pdf`}>
      PDF
    </a>
  );
}

import Link from 'next/link';

// The upload door into sources, dossiers, and draft signals. No data fetch,
// so no try/catch: the only branch is admin (live link) vs guest (grayed,
// disabled span, write access is the author's). "Bare": renders its own
// `.lobby-tile` chrome, same as the portal tiles it now sits beside.
export default function AddDocument({ personal }: { personal: boolean }) {
  return (
    <div className="lobby-tile">
      <span className="lobby-tile-head">
        <span className="lobby-tile-name">Add a document</span>
      </span>
      {personal ? (
        <Link href="/ingest" className="btn btn--ghost">Add a document to the Atlas</Link>
      ) : (
        <span
          className="btn btn--ghost"
          aria-disabled="true"
          title="Admin only"
          style={{ opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' }}
        >
          Add a document to the Atlas · Admin only
        </span>
      )}
      <p className="lobby-upload-note">
        PDFs and articles become sources, dossiers, and draft signals through the same pipeline.
      </p>
    </div>
  );
}

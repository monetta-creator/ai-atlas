'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSheetPublishedAction, deleteSheetAction } from '@/lib/actions';

// The page-top action row for a generated report's read view: PDF for anyone
// who can see the page, publish/unpublish/delete for admins. Split out of the
// portal-list SheetRow (which is a whole expandable card, wrong shape for the
// PageTop action slot) so this page owns just its own button row.
export default function SheetActions({ id, published, admin }: { id: string; published: boolean; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <a href={`/reports/sheet/${id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
      {admin && (
        <>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={busy}
            onClick={() => void act(() => setSheetPublishedAction(id, !published))}
          >
            {published ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Delete this report? This cannot be undone.')) {
                void act(() => deleteSheetAction(id));
              }
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

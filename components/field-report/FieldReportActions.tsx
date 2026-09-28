'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { publishFieldReportAction } from '@/lib/actions';

// The PDF link and, for admins, the publish/unpublish toggle: a keyholder's
// draft becomes visible to every other keyholder only when the admin
// publishes it. Same shape as SheetActions (app/reports/sheet/[id]).
export default function FieldReportActions({ id, isPublished, admin }: { id: string; isPublished: boolean; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await publishFieldReportAction(id, !isPublished);
      if (!res.ok) setError(res.error ?? 'Could not update this report.');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="frv-actions">
      <a href={`/field-reports/${id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
      {admin && (
        <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void toggle()}>
          {isPublished ? 'Unpublish' : 'Publish'}
        </button>
      )}
      {!admin && (
        <span className="frv-status" data-published={isPublished || undefined}>
          {isPublished ? 'Published' : 'Draft, visible to you and the admin'}
        </span>
      )}
      {error && <span className="frv-status" style={{ color: '#c62828' }}>{error}</span>}
    </div>
  );
}

'use client';

import { useFormStatus } from 'react-dom';
import { deleteSourceAction } from '@/lib/actions';

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn--danger btn--sm"
      disabled={pending}
      style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}
    >
      {pending ? 'Deleting…' : 'Delete source'}
    </button>
  );
}

export default function DeleteSourceButton({ sourceId, label }: { sourceId: string; label: string }) {
  return (
    <form
      action={deleteSourceAction}
      onSubmit={(e) => {
        if (!confirm(`Delete “${label}” and all of its evidence? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="source_id" value={sourceId} />
      <Btn />
    </form>
  );
}

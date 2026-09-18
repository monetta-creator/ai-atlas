'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteProductEventAction } from '@/lib/actions';

// Mirrors components/scout/DeleteEventButton.tsx exactly.
export default function DeleteEventButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="text-xs"
      style={{ color: 'var(--faint-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
      title="Delete this event"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await deleteProductEventAction(id);
          router.refresh();
        })
      }
    >
      {pending ? '…' : '✕'}
    </button>
  );
}

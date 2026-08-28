'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setScanTopicActiveAction } from '@/lib/actions';

// Active toggle for one scan topic. Inactive topics drop out of discovery AND
// out of the enrichment tag allow-list (their taxonomy code stops being
// offered), which is why this is a deliberate admin action, not a filter.
export default function TopicToggle({ slug, active }: { slug: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="touch-chip"
      style={{ fontSize: 11, padding: '3px 10px', opacity: pending ? 0.5 : 1 }}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setScanTopicActiveAction(slug, !active);
          router.refresh();
        })
      }
    >
      {active ? 'active' : 'inactive'}
    </button>
  );
}

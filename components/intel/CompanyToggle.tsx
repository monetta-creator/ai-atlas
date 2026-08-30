'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntelCompanyActiveAction } from '@/lib/actions';

// Active toggle for one intel registry company. Inactive companies drop out
// of feeds, search, and filings collection, which is why this is a
// deliberate admin action, not a filter.
export default function CompanyToggle({ slug, active }: { slug: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="touch-chip"
      style={{ fontSize: 11, padding: '3px 10px', opacity: pending ? 0.5 : 1 }}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setIntelCompanyActiveAction(slug, !active);
          router.refresh();
        })
      }
    >
      {active ? 'active' : 'inactive'}
    </button>
  );
}

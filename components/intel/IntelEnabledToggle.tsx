'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setIntelEnabledAction } from '@/lib/actions';

// The intel desk's runtime switch: gates the CRON invocations only (a paused
// desk makes them no-ops); the console's manual Run/resume works regardless.
export default function IntelEnabledToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="touch-chip"
      style={{
        fontSize: 12, padding: '4px 12px', opacity: pending ? 0.5 : 1,
        color: enabled ? 'var(--supports)' : 'var(--heat-4)',
      }}
      disabled={pending}
      title={enabled ? 'Pause the daily crons (manual runs stay available)' : 'Resume the daily crons'}
      onClick={() =>
        startTransition(async () => {
          await setIntelEnabledAction(!enabled);
          router.refresh();
        })
      }
    >
      {enabled ? '● crons on' : '○ crons paused'}
    </button>
  );
}

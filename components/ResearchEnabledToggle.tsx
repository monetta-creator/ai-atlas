'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setResearchEnabledAction } from '@/lib/actions';

// The research engine's runtime switch (the ScanEnabledToggle clone): gates
// the CRON invocations only (a paused engine makes them no-ops); the
// console's manual tick works regardless.
export default function ResearchEnabledToggle({ enabled }: { enabled: boolean }) {
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
          await setResearchEnabledAction(!enabled);
          router.refresh();
        })
      }
    >
      {enabled ? '● crons on' : '○ crons paused'}
    </button>
  );
}

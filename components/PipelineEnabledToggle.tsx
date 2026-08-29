'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPipelineEnabledAction } from '@/lib/actions';

// The pipeline's cron switch: gates the daily cron leg only (the shared
// /api/cron/scan driver skips the pipeline when paused); the console's
// buttons work regardless.
export default function PipelineEnabledToggle({ enabled }: { enabled: boolean }) {
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
      title={enabled ? 'Pause the daily cron leg (console runs stay available)' : 'Resume the daily cron leg'}
      onClick={() =>
        startTransition(async () => {
          await setPipelineEnabledAction(!enabled);
          router.refresh();
        })
      }
    >
      {enabled ? '● daily cron on' : '○ daily cron paused'}
    </button>
  );
}

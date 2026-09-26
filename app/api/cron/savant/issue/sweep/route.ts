import type { NextRequest } from 'next/server';
import { cronGate } from '@/lib/cron/shared';
import { handleIssueCron } from '../route';

// A later window of the same Friday run (see ../route.ts): resumes from the
// legs parked in the notebook, no-ops when the issue already exists.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const denied = cronGate(req);
  if (denied) return denied;
  return handleIssueCron(req);
}

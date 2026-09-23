// Shared by every /api/cron/* route. Dependency-free (no next/server at
// runtime) so scripts/test-cron-gate.mjs can load it in plain Node.

// The Vercel cron convention: the platform sends `Authorization: Bearer
// <CRON_SECRET>`. Fails closed when the env var is unset. Returns the 401
// Response to send, or null when the caller may proceed (the adminGate
// idiom). NextRequest extends Request, so every route passes its own.
export function cronGate(req: Pick<Request, 'headers'>): Response | null {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

// Optional healthchecks.io-style dead-man ping. Fire-and-forget: never
// await-blocks the response, never throws. Each route decides WHEN it fires
// at its call site (completed only, weekly leg only, success path, ...).
export function pingDeadman(url: string | undefined): void {
  if (url) fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => {});
}

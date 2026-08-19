import { isAdmin } from '@/lib/auth';

// Function-duration probe. The codebase long assumed a hard ~60s Vercel Hobby
// cap; Vercel's current documentation says Hobby defaults to 300s with Fluid
// Compute. This route measures the REAL ceiling on this project: it declares
// maxDuration = 300 (if the platform rejects that at deploy time, that itself
// is the finding) and streams a heartbeat line every 5 seconds for ?seconds=N.
// A run that ends without the final SURVIVED line was killed by the platform;
// Vercel cuts streams silently, so the missing line IS the timeout signature.
//
// KEEP this route: it is admin-gated, costs nothing, touches no other code,
// and is the standing regression probe for the day platform limits change.
// Measured results live in docs/data-portal-upgrade-paths.md.
//
// Usage: GET /api/probe/duration?seconds=N (clamped 1..290), admin cookie required.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request): Promise<Response> {
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

  const raw = Number(new URL(req.url).searchParams.get('seconds'));
  const n = Math.min(290, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 60));
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      controller.enqueue(
        enc.encode(`START region=${process.env.VERCEL_REGION ?? 'local'} target=${n}s\n`)
      );
      let elapsed = 0;
      while (elapsed < n) {
        const step = Math.min(5, n - elapsed);
        await sleep(step * 1000);
        elapsed += step;
        controller.enqueue(enc.encode(`t=${elapsed}s alive\n`));
      }
      controller.enqueue(enc.encode(`SURVIVED n=${n}s wall=${Date.now() - t0}ms\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

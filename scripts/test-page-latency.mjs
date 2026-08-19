// Page-navigation latency probe. Measures TTFB (time to first byte of the
// streamed HTML, which is what a navigating user waits for) and total time
// for the app's main routes, N samples each, and reports the median.
//
//   node scripts/test-page-latency.mjs                     # local :3000
//   BASE=https://... node scripts/test-page-latency.mjs    # prod
//   COOKIE="atlas_admin=..." node scripts/...              # as admin
//
// A budget line prints at the end: any route whose median TTFB exceeds
// BUDGET_MS (default 600) is flagged. Exit code 1 when BASE is local and a
// route busts the budget (CI-usable); prod runs are informational.

const BASE = process.env.BASE || 'http://localhost:3000';
const COOKIE = process.env.COOKIE || '';
const SAMPLES = Number(process.env.SAMPLES || 3);
const BUDGET_MS = Number(process.env.BUDGET_MS || 600);

const ROUTES = [
  '/',
  '/blotter',
  '/map',
  '/signals',
  '/reports',
  '/concepts',
  '/research',
  '/datasets',
  '/ask',
  '/bridges',
  '/about',
  '/showcase',
];

async function measure(path) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    headers: COOKIE ? { cookie: COOKIE } : {},
    redirect: 'manual',
  });
  const reader = res.body?.getReader();
  let ttfb = null;
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (ttfb === null) ttfb = performance.now() - t0;
      bytes += value?.length ?? 0;
    }
  }
  const total = performance.now() - t0;
  return { status: res.status, ttfb: ttfb ?? total, total, bytes };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const isLocal = BASE.includes('localhost');
let failed = false;
console.log(`# ${BASE} · ${SAMPLES} samples/route${COOKIE ? ' · with cookie' : ' · sessionless'}\n`);
console.log('route            status  ttfb-med  total-med  bytes');

for (const path of ROUTES) {
  const runs = [];
  let status = 0;
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const r = await measure(path);
      status = r.status;
      runs.push(r);
    } catch (e) {
      console.log(`${path.padEnd(16)} FETCH FAILED: ${e.message}`);
      failed = true;
      break;
    }
  }
  if (!runs.length) continue;
  const ttfb = median(runs.map((r) => r.ttfb));
  const total = median(runs.map((r) => r.total));
  const over = ttfb > BUDGET_MS;
  if (over && isLocal) failed = true;
  console.log(
    `${path.padEnd(16)} ${String(status).padEnd(6)} ${`${ttfb.toFixed(0)}ms`.padStart(8)} ${`${total.toFixed(0)}ms`.padStart(9)}  ${(runs[0].bytes / 1024).toFixed(0)}kB${over ? '  ⚠ over budget' : ''}`
  );
}

console.log(`\nbudget: TTFB ≤ ${BUDGET_MS}ms per route${isLocal ? ' (enforced locally)' : ' (informational on remote)'}`);
process.exit(failed ? 1 : 0);

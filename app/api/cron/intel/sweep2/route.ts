// The third DAILY invocation, 13:20 UTC (Vercel keys cron jobs by PATH, so
// it needs its own stub like /sweep). Monday-only from 2026-08-31 (the 3-day
// lookback's triple batch overran two windows); every weekday since
// 2026-09-03, when the scan and research engines overran their two windows
// on an ordinary Wednesday and intel finished with 3 minutes to spare. Any
// day the sweep already finished, it returns alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

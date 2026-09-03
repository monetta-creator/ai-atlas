// The third DAILY invocation, 13:40 UTC (Vercel keys cron jobs by PATH, so
// it needs its own stub like /sweep). Monday+Tuesday-only from 2026-08-31
// (Monday's 3-day lookback and Tuesday's heavy arXiv announce day both
// overran two windows); every weekday since 2026-09-03, when an ordinary
// Wednesday (224 pulled) ran out of budget in the analyze step with 39
// papers left. Any day the sweep already finished, it returns
// alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

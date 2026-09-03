// The third DAILY invocation, 13:00 UTC (Vercel keys cron jobs by PATH, so
// it needs its own stub like /sweep). It was Monday-only from 2026-08-31 (the
// 3-day lookback's triple batch overran two windows); on 2026-09-03 an
// ordinary Wednesday overran them too (219 items, the relevance-ensemble
// votes riding each enrich slot), so it runs every weekday now. Any day the
// sweep already finished, it returns alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

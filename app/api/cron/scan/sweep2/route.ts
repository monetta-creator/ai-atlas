// The Monday-only third invocation (Vercel keys cron jobs by PATH, so it
// needs its own stub like /sweep). Monday's 3-day lookback produces a
// triple-size batch that overran the two regular windows on 2026-08-31;
// this one picks up whatever the sweep left. Every other day, and any
// Monday the sweep finished, it returns alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

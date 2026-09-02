// The third daily invocation, Monday and Tuesday (Vercel keys cron jobs by
// PATH, so it needs its own stub like /sweep). Monday's 3-day lookback
// produces a triple-size batch that overran the two regular windows on
// 2026-08-31; arXiv also announces Sunday+Monday submissions on Tuesday,
// making Tuesday the heavier pull day (336 pulled Tue vs 196 Mon,
// observed). This one picks up whatever the sweep left; any day the sweep
// already finished, it returns alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

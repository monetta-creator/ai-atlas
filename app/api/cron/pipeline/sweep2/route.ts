// The pipeline's third DAILY invocation, not Monday-only (Vercel keys cron
// jobs by PATH, so it needs its own stub like /sweep). A run left in
// step=analysis by a flaky candidate in the 11:20 window gets one more
// window here; alreadyComplete no-ops otherwise.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

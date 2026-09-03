// The fourth daily invocation, 15:20 UTC, the weekday catch-all added
// 2026-09-03 (Vercel keys cron jobs by PATH, so it needs its own stub like
// /sweep). Four 700s windows a day is the wall-clock budget the engines are
// sized against now; a run still unfinished after this one shows as
// "running" on the Lobby tracker until the console's manual resume. Any day
// an earlier window finished, it returns alreadyComplete for free.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

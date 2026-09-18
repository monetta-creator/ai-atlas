// The tooling monitor's second weekly invocation. Vercel keys cron jobs by
// PATH, so two vercel.json entries on one path collapse to one; the second
// weekly invocation needs its own path. Same handler, same gate: it resumes
// whatever the first invocation's budget could not finish.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

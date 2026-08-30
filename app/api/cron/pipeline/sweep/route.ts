// The pipeline sweeper's entry point. Vercel keys cron jobs by PATH, so two
// vercel.json entries on one path collapse to one (observed live 2026-08-28);
// the second daily invocation needs its own path. Same handler, same gate:
// it resumes whatever the first invocation's budget could not finish.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

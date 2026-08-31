// The research engine's sweeper entry point. Vercel keys cron jobs by PATH, so
// two vercel.json entries on one path collapse to one (the same lesson the
// scan/pipeline/intel sweeps were built on); the second daily invocation
// needs its own path. Same handler, same gate: it resumes whatever the first
// invocation's budget could not finish.
export { GET } from '../route';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { isAdmin } from '@/lib/auth';
import { getAgentPrefs, getAgentSpendToday, getLatestBrief, listAgentActions, listFindings } from '@/lib/data';

// The drawer/page's one data fetch: everything the tabs need in one round
// trip. Admin-only, no-store (findings and actions change on every tick).
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const [findings, actions, brief, prefs, spend] = await Promise.all([
    listFindings({ states: ['open', 'acked', 'snoozed'] }),
    listAgentActions(50),
    getLatestBrief(),
    getAgentPrefs(),
    getAgentSpendToday(),
  ]);
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && (process.env.AGENT_EMAIL_TO || prefs.email_to));
  return Response.json(
    { findings, actions, brief, prefs, spend, emailConfigured },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

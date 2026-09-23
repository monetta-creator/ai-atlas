// The one Resend sender (a plain fetch, no SDK), shared by the agent's morning
// brief (lib/agent/email.ts) and the portal's access-request notices
// (lib/portal/email.ts). Without a verified sending domain Resend delivers
// only to the account owner's address, which is exactly who these notices go
// to; AGENT_EMAIL_FROM overrides the onboarding sender once a domain exists.
// Returns a result instead of throwing so callers can note and move on.

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(opts: { to: string; subject: string; html: string; from?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !opts.to?.trim()) return { ok: false, error: 'Resend not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from || process.env.AGENT_EMAIL_FROM || 'The AI Atlas <onboarding@resend.dev>',
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'sendEmail failed' };
  } finally {
    clearTimeout(timer);
  }
}

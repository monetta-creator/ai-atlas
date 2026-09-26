import { q } from '../db';
import { sendEmail } from '../email/resend';
import { enforceCitations } from '../citations';
import { allowlistForSavant } from './allowlist';
import { SAVANT_STRAPLINE, SAVANT_TOC } from './types';
import type { SavedSavantIssue } from './types';
import { dateLabel } from '../format';

// Savant's Friday email (Phase 3): the executive summary and the table of
// contents with a link to the issue, to the admin and to every active key
// holder who opted in (portal_keys.savant_email). One send per recipient
// (lib/email/resend.ts is single-recipient). Without a verified Resend
// sending domain only the account owner receives mail; the run records who
// was skipped rather than failing.

interface Recipient { email: string; who: string }

export async function savantRecipients(): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const admin = process.env.AGENT_EMAIL_TO?.trim();
  if (admin) out.push({ email: admin, who: 'admin' });
  else {
    const row = await q<{ email_to: string | null }>(`select email_to from agent_prefs where id = true`);
    if (row[0]?.email_to) out.push({ email: row[0].email_to, who: 'admin' });
  }
  const keys = await q<{ email: string; name: string | null }>(
    `select email, name from portal_keys
      where savant_email and email is not null and revoked_at is null and (expires_at is null or expires_at > now())`
  ).catch(() => [] as { email: string; name: string | null }[]);
  for (const k of keys) if (!out.find((r) => r.email.toLowerCase() === k.email.toLowerCase())) out.push({ email: k.email, who: k.name ?? "key holder" });
  return out;
}

export function renderSavantEmail(issue: SavedSavantIssue, origin: string): { subject: string; html: string } {
  const { pack, narrative } = issue;
  const allow = allowlistForSavant(pack);
  const abs = (h: string) => (h.startsWith('/') ? origin + h : h);
  const bullets = narrative.summary
    .map((s) => enforceCitations(s, allow).html ?? '')
    .map((s) => s.replace(/href="(\/[^"]*)"/g, (_m, h: string) => `href="${abs(h)}"`))
    .map((s) => `<li style="margin:0 0 10px">${s.replace(/^<p>|<\/p>$/g, '')}</li>`)
    .join('');
  const toc = SAVANT_TOC.map((t) => `<li><a href="${origin}/savant/${issue.week_end}#${t.key}" style="color:#2d5bff">${t.title}</a></li>`).join('');
  const subject = `Savant No. ${pack.issueNumber}: ${narrative.title}`;
  const html =
    `<div style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:24px">` +
    `<p style="font-size:12px;letter-spacing:2px;color:#5b6675;margin:0">THE AI ATLAS</p>` +
    `<h1 style="font-family:Georgia,serif;font-style:italic;font-size:40px;margin:4px 0 2px;color:#2d5bff">Savant</h1>` +
    `<p style="font-size:12px;color:#5b6675;margin:0 0 18px">${SAVANT_STRAPLINE}</p>` +
    `<p style="font-size:12px;color:#95a0b1;margin:0 0 6px">Issue No. ${pack.issueNumber} · week ending ${dateLabel(issue.week_end)}</p>` +
    `<h2 style="font-size:22px;margin:0 0 14px">${narrative.title}</h2>` +
    `<ol style="padding-left:20px;font-size:15px;line-height:1.5">${bullets}</ol>` +
    `<p style="margin:22px 0"><a href="${origin}/savant/${issue.week_end}" style="background:#2d5bff;color:#fff;padding:10px 16px;text-decoration:none;font-weight:600">Read the issue</a> ` +
    `<a href="${origin}/savant/${issue.week_end}/pdf" style="margin-left:12px;color:#2d5bff">PDF</a></p>` +
    `<p style="font-size:12px;color:#5b6675;margin:0 0 6px">In this issue</p><ol style="font-size:13px;line-height:1.6;color:#5b6675;padding-left:20px">${toc}</ol>` +
    `<p style="font-size:11px;color:#95a0b1;margin-top:24px">Researched through the week from public sources, written by Savant, reviewed by ${narrative.editor?.name ?? 'the Desk Editor'}. Every figure links to its record. Read with your access key.</p>` +
    `</div>`;
  return { subject, html };
}

export async function sendSavantIssue(issue: SavedSavantIssue, origin: string): Promise<{ sent: string[]; failed: { email: string; error: string }[] }> {
  const recipients = await savantRecipients();
  const { subject, html } = renderSavantEmail(issue, origin);
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  for (const r of recipients) {
    const res = await sendEmail({ to: r.email, subject, html });
    if (res.ok) sent.push(r.email);
    else failed.push({ email: r.email, error: res.error ?? 'send failed' });
  }
  return { sent, failed };
}

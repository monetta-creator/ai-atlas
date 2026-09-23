// The morning brief's email leg: a plain fetch to Resend, no SDK. Pure aside
// from the network calls (no lib/db import anywhere in this file), so
// renderBriefHtml loads under plain-Node type stripping for the test script.

import type { AgentBrief, AgentFinding, AgentPrefs, BriefMemo } from './types';

const DEFAULT_BASE = 'https://ai-atlas-kevin-michel-s-projects.vercel.app';

export function isEmailConfigured(prefs: AgentPrefs): boolean {
  const to = process.env.AGENT_EMAIL_TO || prefs?.email_to || '';
  return Boolean(process.env.RESEND_API_KEY && to.trim());
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ageLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

const SEVERITY_COLOR: Record<string, string> = { high: '#b91c1c', warn: '#b45309', info: '#475569' };

// Inline-styled HTML: email clients strip <style> blocks unpredictably, so
// every rule lives on the element. System font stack, no external assets.
export function renderBriefHtml(day: string, memo: BriefMemo, findings: AgentFinding[]): string {
  const base = process.env.APP_BASE_URL || DEFAULT_BASE;
  const font = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;";
  const sections = (memo.sections ?? [])
    .map(
      (s) => `
        <tr><td style="padding: 16px 0 4px; ${font} font-size: 15px; font-weight: 600; color: #111827;">${esc(s.title)}</td></tr>
        <tr><td style="padding: 0 0 4px; ${font} font-size: 14px; line-height: 1.5; color: #374151;">${esc(s.body)}</td></tr>`
    )
    .join('');

  const rows = findings
    .slice(0, 25)
    .map((f) => {
      const color = SEVERITY_COLOR[f.severity] ?? SEVERITY_COLOR.info;
      const href = f.href ? `${base}${f.href}` : base;
      return `
        <tr>
          <td style="padding: 6px 8px; ${font} font-size: 12px; font-weight: 600; color: ${color}; text-transform: uppercase; vertical-align: top;">${esc(f.severity)}</td>
          <td style="padding: 6px 8px; ${font} font-size: 13px; color: #111827; vertical-align: top;">
            <a href="${href}" style="color: #111827; text-decoration: none;">${esc(f.title)}</a>
          </td>
          <td style="padding: 6px 8px; ${font} font-size: 12px; color: #6b7280; vertical-align: top; white-space: nowrap;">${esc(ageLabel(f.last_seen))}</td>
        </tr>`;
    })
    .join('');

  const proposals = (memo.proposals ?? [])
    .map((p) => `<li style="${font} font-size: 13px; color: #374151; padding: 2px 0;">${esc(p.text)}</li>`)
    .join('');
  const willDo = (memo.willDo ?? [])
    .map((p) => `<li style="${font} font-size: 13px; color: #374151; padding: 2px 0;">${esc(p.text)}</li>`)
    .join('');

  return `<!doctype html>
<html><body style="margin: 0; padding: 0; background: #f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f3f4f6; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 8px; overflow: hidden;">
        <tr><td style="padding: 20px 24px 4px; ${font} font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Atlas Agent, ${esc(day)}</td></tr>
        <tr><td style="padding: 0 24px 16px; ${font} font-size: 20px; font-weight: 700; color: #111827;">${esc(memo.headline)}</td></tr>
        <tr><td style="padding: 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table></td></tr>
        ${
          proposals
            ? `<tr><td style="padding: 16px 24px 0; ${font} font-size: 14px; font-weight: 600; color: #111827;">Needs your tap</td></tr>
               <tr><td style="padding: 4px 24px 0;"><ul style="margin: 0; padding-left: 18px;">${proposals}</ul></td></tr>`
            : ''
        }
        ${
          willDo
            ? `<tr><td style="padding: 16px 24px 0; ${font} font-size: 14px; font-weight: 600; color: #111827;">On its own, next tick</td></tr>
               <tr><td style="padding: 4px 24px 0;"><ul style="margin: 0; padding-left: 18px;">${willDo}</ul></td></tr>`
            : ''
        }
        <tr><td style="padding: 20px 24px 8px; ${font} font-size: 14px; font-weight: 600; color: #111827;">Open findings</td></tr>
        <tr><td style="padding: 0 16px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows || `<tr><td style="padding: 6px 8px; ${font} font-size: 13px; color: #6b7280;">Nothing open.</td></tr>`}</table></td></tr>
        <tr><td style="padding: 12px 24px; border-top: 1px solid #e5e7eb; ${font} font-size: 11px; color: #9ca3af;">
          <a href="${base}/agent" style="color: #9ca3af;">Open the Atlas Agent</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendBriefEmail(opts: { to: string; subject: string; html: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !opts.to?.trim()) return { ok: false, error: 'Resend not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.AGENT_EMAIL_FROM || 'Atlas Agent <onboarding@resend.dev>',
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
    return { ok: false, error: e instanceof Error ? e.message : 'sendBriefEmail failed' };
  } finally {
    clearTimeout(timer);
  }
}

// Referenced by callers that want the brief's subject line consistent
// everywhere (the runner, and any future resend-on-demand action).
export function briefSubject(brief: Pick<AgentBrief, 'memo'>): string {
  return `Atlas · ${brief.memo.headline || 'Daily brief'}`;
}

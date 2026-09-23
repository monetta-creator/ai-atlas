// The access-key emails, the pure half: no lib/db import anywhere in this
// file, so the renderers load under plain-Node type stripping for tests.
// Inline-styled like lib/agent/email.ts renderBriefHtml (email clients strip
// <style> blocks unpredictably); every interpolated field passes esc().
// Reader-facing copy says "access key" and "the maintainer", never a name or
// the employer.

const FONT = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;";

export function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(kicker: string, title: string, body: string, footer: string): string {
  return `<!doctype html>
<html><body style="margin: 0; padding: 0; background: #f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f3f4f6; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 8px; overflow: hidden;">
        <tr><td style="padding: 20px 24px 4px; ${FONT} font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">${kicker}</td></tr>
        <tr><td style="padding: 0 24px 16px; ${FONT} font-size: 20px; font-weight: 700; color: #111827;">${title}</td></tr>
        <tr><td style="padding: 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
        <tr><td style="padding: 12px 24px; border-top: 1px solid #e5e7eb; ${FONT} font-size: 11px; color: #9ca3af;">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `
        <tr><td style="padding: 12px 0 2px; ${FONT} font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;">${esc(label)}</td></tr>
        <tr><td style="padding: 0 0 4px; ${FONT} font-size: 14px; line-height: 1.5; color: #111827; word-break: break-word;">${value}</td></tr>`;
}

export function accessRequestSubject(name: string): string {
  return `Atlas access request: ${name}`;
}

// To the maintainer: someone filled in the public request form. The console
// link lands on the access desk where the request is approved or declined.
export function renderAccessRequestHtml(input: { name: string; email: string; reason: string | null | undefined; userAgent: string | null | undefined; consoleUrl: string }): string {
  const console = esc(input.consoleUrl);
  const body =
    row('Name', esc(input.name)) +
    row('Email', `<a href="mailto:${esc(input.email)}" style="color: #111827;">${esc(input.email)}</a>`) +
    row('Reason', input.reason?.trim() ? esc(input.reason) : '<span style="color: #9ca3af;">none given</span>') +
    row('Browser', input.userAgent?.trim() ? `<span style="font-size: 12px; color: #6b7280;">${esc(input.userAgent)}</span>` : '<span style="color: #9ca3af;">unknown</span>') +
    `
        <tr><td style="padding: 20px 0 8px;">
          <a href="${console}" style="display: inline-block; padding: 10px 16px; background: #111827; color: #ffffff; border-radius: 6px; ${FONT} font-size: 14px; font-weight: 600; text-decoration: none;">Review on the access desk</a>
        </td></tr>`;
  return shell('The AI Atlas, access request', `${esc(input.name)} asked for an access key`, body, `<a href="${console}" style="color: #9ca3af;">${console}</a>`);
}

// To the person: their key was issued. The link carries the key once; the
// key itself is never stored in clear, so the email is the only copy.
export function renderKeyIssuedHtml(input: { name: string; link: string; expiresAt: string | Date; host: string }): string {
  const link = esc(input.link);
  // Accepts a bare host or a full origin; rendered as the bare host either way.
  const host = esc(input.host.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
  const day = new Date(input.expiresAt);
  const expires = Number.isFinite(day.getTime()) ? day.toISOString().slice(0, 10) : String(input.expiresAt);
  const body = `
        <tr><td style="padding: 0 0 12px; ${FONT} font-size: 14px; line-height: 1.5; color: #374151;">Hello ${esc(input.name)}, your access key to the AI Atlas is ready. Open the link below once in your browser and it signs you in on ${host}; the Ask workspace and the key-gated datasets unlock from there.</td></tr>
        <tr><td style="padding: 8px 0 16px;">
          <a href="${link}" style="display: inline-block; padding: 10px 16px; background: #111827; color: #ffffff; border-radius: 6px; ${FONT} font-size: 14px; font-weight: 600; text-decoration: none;">Open the Atlas</a>
        </td></tr>
        <tr><td style="padding: 0 0 12px; ${FONT} font-size: 13px; line-height: 1.5; color: #374151;">If the button does not work, paste this address into your browser:<br><a href="${link}" style="color: #111827; word-break: break-all;">${link}</a></td></tr>
        <tr><td style="padding: 0 0 12px; ${FONT} font-size: 13px; line-height: 1.5; color: #374151;">The key expires on ${esc(expires)}. Ask the maintainer to renew it when it does; your saved views are kept. Keep this email to yourself: the link is your key, and it is not stored anywhere else.</td></tr>
        <tr><td style="padding: 0 0 8px; ${FONT} font-size: 13px; line-height: 1.5; color: #6b7280;">Scripts can send the same key as a header instead of a cookie: <code style="font-size: 12px;">Authorization: Bearer atlas_...</code> or <code style="font-size: 12px;">X-Atlas-Key</code>.</td></tr>`;
  return shell('The AI Atlas, access key', 'Your access key', body, `Sent by the maintainer of the AI Atlas at <a href="https://${host}" style="color: #9ca3af;">${host}</a>`);
}

'use client';

import { useState, type FormEvent } from 'react';

// The public "Request access" form. Posts JSON to /api/access/request, which
// validates, rate-limits and records the request, then notifies the
// maintainer. The hidden `website` field is the honeypot (same idiom as the
// feedback dialogs): a bot that fills it gets a quiet success.
type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export default function RequestAccessForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get('name') ?? '').trim(),
      email: String(fd.get('email') ?? '').trim(),
      reason: String(fd.get('reason') ?? '').trim(),
      website: String(fd.get('website') ?? ''),
    };
    if (!payload.name || !payload.email) {
      setStatus({ kind: 'error', message: 'Your name and a work email are both needed.' });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus({ kind: 'error', message: body.error || 'That did not go through. Try again in a minute.' });
        return;
      }
      setStatus({ kind: 'sent' });
    } catch {
      setStatus({ kind: 'error', message: 'Network trouble. Try again in a minute.' });
    }
  }

  if (status.kind === 'sent') {
    return (
      <div className="plate" role="status" style={{ borderColor: 'var(--supports)', padding: 'var(--card-pad)' }}>
        <div className="section-label">Request sent</div>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--dim)', margin: '10px 0 0' }}>
          The maintainer has it. When it is approved your key arrives as a link to the address you gave;
          open that link once and this browser is unlocked. Nothing else to do here.
        </p>
      </div>
    );
  }

  const sending = status.kind === 'sending';
  return (
    <form onSubmit={submit} className="plate" style={{ padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input className="fb-hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div className="field">
        <label htmlFor="ra-name">Your name</label>
        <input id="ra-name" className="input" name="name" required maxLength={120} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="ra-email">Work email</label>
        <input id="ra-email" className="input" name="email" type="email" required maxLength={200} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="ra-reason">What you want to do with it (optional)</label>
        <textarea id="ra-reason" className="input" name="reason" rows={3} maxLength={1000}
          placeholder="A sentence is plenty: which datasets, which questions, which team." />
      </div>
      {status.kind === 'error' && (
        <p style={{ fontSize: 12.5, color: 'var(--heat-4)', margin: 0 }}>{status.message}</p>
      )}
      <div>
        <button type="submit" className="btn btn--primary" disabled={sending}>
          {sending ? 'Sending…' : 'Request an access key'}
        </button>
      </div>
    </form>
  );
}

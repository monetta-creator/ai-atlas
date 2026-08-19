'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { TicketKind } from '@/lib/types';

// One dialog, two personalities: the bug report (a beetle crawls along the top
// edge while you type) and the feature request (an idea spark comets across).
// Free text + a short name + required email + optional screenshots, POSTed as
// multipart form data to the public /api/tickets intake. Screenshots are
// downscaled client-side (canvas, max 1600px, JPEG) before upload so the
// server cap is never the user's problem.

const MAX_IMAGES = 3;
const MAX_DIM = 1600;

interface Shot { blob: Blob; url: string; name: string }

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  return blob ?? file;
}

function BugMascot() {
  return (
    <div className="fb-mascot-track" aria-hidden="true">
      <div className="fb-bug">
        <svg viewBox="0 0 26 20" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <g className="fb-legs-a">
            <path d="M9 7.6 L6.5 3.8" />
            <path d="M12 14.4 L12 18.4" />
            <path d="M15 7.6 L17.5 3.8" />
          </g>
          <g className="fb-legs-b">
            <path d="M9 14.4 L6.5 18.2" />
            <path d="M12 7.6 L12 3.6" />
            <path d="M15 14.4 L17.5 18.2" />
          </g>
          <ellipse cx="12" cy="11" rx="5.2" ry="4.1" fill="var(--surface)" />
          <ellipse cx="12" cy="11" rx="5.2" ry="4.1" />
          <path d="M12 6.9 v8.2" opacity="0.45" />
          <circle cx="18.7" cy="11" r="2" fill="var(--surface)" />
          <circle cx="18.7" cy="11" r="2" />
          <path d="M20.2 9.7 L23 7.4" />
          <path d="M20.2 12.3 L23 14.6" />
        </svg>
      </div>
    </div>
  );
}

function SparkMascot() {
  return (
    <div className="fb-mascot-track" aria-hidden="true">
      <span className="fb-spark">✦</span>
    </div>
  );
}

const COPY: Record<TicketKind, {
  kicker: string; title: string; sub: string; nameLabel: string; namePh: string;
  bodyLabel: string; bodyPh: string; cta: string; doneGlyph: string; doneHead: string; doneSub: string;
}> = {
  bug: {
    kicker: 'Oh no! You found a bug!',
    title: 'What happened?',
    sub: 'Tell us what broke and what you expected instead. Screenshots help the hunt.',
    nameLabel: 'Name the bug',
    namePh: 'e.g. The signal filters forget my lens',
    bodyLabel: 'What happened?',
    bodyPh: 'What did you do, what broke, and what did you expect instead?',
    cta: 'File the bug',
    doneGlyph: '🫙',
    doneHead: 'Caught. The bug is in the jar.',
    doneSub: 'It joins the queue on the admin desk. If we need more, we will write to your email.',
  },
  feature: {
    kicker: 'Ooh! An idea!',
    title: 'What should the Atlas do next?',
    sub: 'Describe the feature and what it would help you do. Sketches welcome.',
    nameLabel: 'Name the idea',
    namePh: 'e.g. Weekly digest email of new signals',
    bodyLabel: 'The idea',
    bodyPh: 'What would it do, and what would it help you do?',
    cta: 'Send the idea ✦',
    doneGlyph: '✦',
    doneHead: 'Logged. Good ideas get built here.',
    doneSub: 'It joins the queue on the admin desk. If it ships, your email hears it first.',
  },
};

const SEVERITIES = [
  { value: 'cosmetic', label: 'Cosmetic' },
  { value: 'annoying', label: 'Annoying' },
  { value: 'blocking', label: 'Blocking' },
];

export default function FeedbackDialog({
  kind, open, onClose,
}: { kind: TicketKind; open: boolean; onClose: () => void }) {
  const path = usePathname();
  const c = COPY[kind];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [severity, setSeverity] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next: Shot[] = [];
    for (const f of Array.from(list)) {
      if (shots.length + next.length >= MAX_IMAGES) break;
      if (!f.type.startsWith('image/')) continue;
      try {
        const blob = await downscale(f);
        next.push({ blob, url: URL.createObjectURL(blob), name: f.name });
      } catch {
        setError('That image could not be read.');
      }
    }
    if (next.length) setShots((s) => [...s, ...next]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeShot(i: number) {
    setShots((s) => {
      URL.revokeObjectURL(s[i].url);
      return s.filter((_, j) => j !== i);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const fd = new FormData();
      fd.set('kind', kind);
      fd.set('title', title);
      fd.set('body', body);
      fd.set('email', email);
      if (severity) fd.set('severity', severity);
      fd.set('page', path ?? '');
      shots.forEach((s, i) => fd.append('images', s.blob, s.name || `shot-${i + 1}.jpg`));
      const res = await fetch('/api/tickets', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? 'That did not go through. Please try again.');
        return;
      }
      setDone(true);
    } catch {
      setError('That did not go through. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function resetAndClose() {
    for (const s of shots) URL.revokeObjectURL(s.url);
    setTitle(''); setBody(''); setSeverity(null); setShots([]);
    setDone(false); setError(null);
    onClose();
  }

  return (
    <div className="fb-overlay" role="presentation" onClick={resetAndClose}>
      <div
        className="fb-card"
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'bug' ? 'Report a bug' : 'Request a feature'}
        onClick={(e) => e.stopPropagation()}
      >
        {kind === 'bug' ? <BugMascot /> : <SparkMascot />}
        <button type="button" className="btn btn--quiet btn--sm fb-close" onClick={resetAndClose} aria-label="Close">✕</button>

        {done ? (
          <div className="fb-done">
            <div className="fb-done-glyph" aria-hidden="true">{c.doneGlyph}</div>
            <p className="fb-title" style={{ marginBottom: 6 }}>{c.doneHead}</p>
            <p className="fb-sub">{c.doneSub}</p>
            <button type="button" className="btn btn--primary btn--sm" onClick={resetAndClose}>Back to the Atlas</button>
          </div>
        ) : (
          <>
            <p className="fb-kicker">{c.kicker}</p>
            <h2 className="fb-title">{c.title}</h2>
            <p className="fb-sub">{c.sub}</p>

            <form className="fb-form" onSubmit={(e) => void submit(e)}>
              {/* honeypot: humans never see it, bots love it */}
              <input className="fb-hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

              <div className="field">
                <label htmlFor={`fb-title-${kind}`}>{c.nameLabel}</label>
                <input
                  id={`fb-title-${kind}`} className="input" required maxLength={120}
                  placeholder={c.namePh} value={title} onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor={`fb-body-${kind}`}>{c.bodyLabel}</label>
                <textarea
                  id={`fb-body-${kind}`} className="input" required rows={5} maxLength={5000}
                  placeholder={c.bodyPh} value={body} onChange={(e) => setBody(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 110 }}
                />
              </div>

              {kind === 'bug' && (
                <div className="field">
                  <label>How bad is it?</label>
                  <div className="fb-sev" role="group" aria-label="Severity">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s.value} type="button" data-on={severity === s.value ? '' : undefined}
                        onClick={() => setSeverity((v) => (v === s.value ? null : s.value))}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor={`fb-email-${kind}`}>Your email (so we can follow up)</label>
                <input
                  id={`fb-email-${kind}`} className="input" required type="email" maxLength={200}
                  placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor={`fb-shots-${kind}`}>
                  Screenshots {kind === 'bug' ? '(the crime scene)' : '(sketches, references)'} · up to {MAX_IMAGES}
                </label>
                <input
                  id={`fb-shots-${kind}`} ref={fileRef} type="file" accept="image/*" multiple
                  onChange={(e) => void addFiles(e.target.files)}
                  disabled={shots.length >= MAX_IMAGES}
                  style={{ fontSize: 13 }}
                />
                {shots.length > 0 && (
                  <div className="fb-thumbs" style={{ marginTop: 8 }}>
                    {shots.map((s, i) => (
                      <div key={s.url} className="fb-thumb">
                        {/* object-URL preview of a local blob; next/image adds nothing here */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={`Screenshot ${i + 1}`} />
                        <button type="button" onClick={() => removeShot(i)} aria-label={`Remove screenshot ${i + 1}`}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="fb-error">{error}</p>}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                <button type="submit" className="btn btn--primary" disabled={sending}>
                  {sending ? 'Sending…' : c.cta}
                </button>
                <span style={{ fontSize: 11.5, color: 'var(--faint-ink)' }}>
                  Goes straight to the admin desk.
                </span>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { START_HERE } from '@/lib/start-here';
import { EXAMPLE_QUESTIONS } from '@/components/ask/starters';
import { PORTAL_ICONS } from '@/components/portal-icons';

const SEEN_KEY = 'atlas_start_seen_v1';

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // private mode / storage blocked: the dialog just reopens next visit
  }
}

// "Where do I start?" — a short tutorial dialog: what the Atlas is, why it
// exists, what it does differently, the eight portals, and three starter
// questions. Reachable from the lobby (a round ? button beside Ask, which
// also auto-opens the dialog once per browser) and from the /ask empty state
// (a plain text link, never auto-opening). Same overlay idiom as PageInfo and
// the feedback dialogs: Escape, backdrop, and the close button all dismiss.
export default function StartHere({
  variant, autoOpen, onPick,
}: {
  variant: 'button' | 'link';
  autoOpen?: boolean;
  // On /ask the workspace is already mounted and its ?q= seed effect runs once,
  // so a router.push there would change the URL and send nothing.
  onPick?: (q: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Auto-open once per browser, deferred so the mount effect never sets state
  // synchronously in its own body (the compiler-safe seed idiom used by the
  // lobby's ?q= auto-send effect).
  useEffect(() => {
    if (!autoOpen) return;
    let seen = true;
    try {
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {
      seen = true; // can't tell: don't nag
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        markSeen();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    setOpen(false);
    markSeen();
  }

  function askStarter(q: string) {
    close();
    if (onPick) onPick(q);
    else router.push(`/ask?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      {variant === 'button' ? (
        <button
          type="button"
          className="lobby-start-btn"
          aria-label="Where do I start?"
          aria-haspopup="dialog"
          title="Where do I start?"
          onClick={() => setOpen(true)}
        >
          ?
        </button>
      ) : (
        <button type="button" className="ask-start-link" onClick={() => setOpen(true)}>
          Where do I start?
        </button>
      )}

      {open && (
        <div className="fb-overlay" role="presentation" onClick={close}>
          <div
            className="fb-card sh-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sh-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="btn btn--quiet btn--sm fb-close"
              onClick={close}
              autoFocus
              aria-label="Close"
            >
              ✕
            </button>
            <p className="fb-kicker">{START_HERE.kicker}</p>
            <h2 id="sh-title" className="fb-title">{START_HERE.title}</h2>
            {START_HERE.what.map((p, i) => (
              <p key={i} className="sh-what">{p}</p>
            ))}

            <div className="sh-h">Why it exists</div>
            <ul className="sh-why">
              {START_HERE.why.map((b, i) => <li key={i}>{b}</li>)}
            </ul>

            <div className="sh-h">What it does differently</div>
            <div className="sh-table-wrap">
              <table className="sh-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Search</th>
                    <th>A chatbot</th>
                    <th>The Atlas</th>
                  </tr>
                </thead>
                <tbody>
                  {START_HERE.different.map((row) => (
                    <tr key={row.axis}>
                      <th scope="row">{row.axis}</th>
                      <td>{row.search}</td>
                      <td>{row.chatbot}</td>
                      <td className="sh-table-atlas">{row.atlas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sh-h">The portals</div>
            <div className="sh-portals">
              {START_HERE.portals.map((p) => (
                <Link key={p.href} href={p.href} className="sh-portal" onClick={close}>
                  <span className="sh-portal-icon">{PORTAL_ICONS[p.icon]}</span>
                  <span className="sh-portal-name">{p.name}</span>
                  <span className="sh-portal-line">{p.line}</span>
                </Link>
              ))}
            </div>

            <div className="sh-h">Start with a question</div>
            <p className="sh-what">{START_HERE.askLine}</p>
            <div className="sh-starters">
              {EXAMPLE_QUESTIONS.slice(0, 3).map((q) => (
                <button key={q} type="button" className="lenschip" onClick={() => askStarter(q)}>
                  {q}
                </button>
              ))}
            </div>

            <p className="sh-foot">
              <Link href={START_HERE.tourHref} onClick={close}>{START_HERE.tourLabel} →</Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}

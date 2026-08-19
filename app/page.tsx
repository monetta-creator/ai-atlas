import Link from 'next/link';
import type { ReactNode } from 'react';
import { isAdmin, isPreview } from '@/lib/auth';
import { getNavCounts } from '@/lib/data';
import Header from '@/components/Header';
import LobbyAsk from '@/components/lobby/LobbyAsk';
import { PORTAL_ICONS } from '@/components/portal-icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The AI Atlas' };

// The lobby (2026-08-13 redesign, AlphaSense direction): a greeting, the chat
// launcher, then six live tiles as the premier navigation. The broadsheet
// dashboard that used to live here moved wholesale to /blotter. Everything on
// this page is guest-safe counts; the admin desk row is the one personal extra.

// Server-rendered time-of-day. Pinned to Eastern (a single-user tool with US
// colleagues) so the serverless region's clock never decides the greeting.
function greetingET(): string {
  const hour = Number(
    new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })
  );
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// One greeting per landing, drawn at render time (the page is force-dynamic,
// so every visit rolls again): the time-of-day classic plus a few welcoming,
// Atlas-flavored lines.
function greeting(): string {
  const pool = [
    `${greetingET()}.`,
    'Welcome back.',
    'Hello, human.',
    'Signal over noise.',
    'The debate, mapped.',
    'What did AI do today?',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

const ICONS = PORTAL_ICONS;

export default async function Lobby() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  const counts = personal ? await getNavCounts().catch(() => null) : null;

  const tiles: { href: string; icon: ReactNode; name: string; desc: string }[] = [
    {
      href: '/signals',
      icon: ICONS.signals,
      name: 'Signal Board',
      desc: 'Tracked AI developments, sorted by audience lens and tied to the claims they touch.',
    },
    {
      href: '/blotter',
      icon: ICONS.blotter,
      name: 'News Blotter',
      desc: 'The editor’s desk: the fortnight report, claims ledger, signal wire, and pipeline analytics.',
    },
    {
      href: '/map',
      icon: ICONS.claims,
      name: 'Claims & Theses',
      desc: 'The argument map: open questions, falsifiable claims, and the standing theses they test.',
    },
    {
      href: '/reports',
      icon: ICONS.reports,
      name: 'Report Portal',
      desc: 'Saved period reports and thesis reports, published read-only from the corpus.',
    },
    {
      href: '/datasets',
      icon: ICONS.data,
      name: 'Data Portal',
      desc: 'Self-service datasets from the Atlas corpus, with schema pages and CSV or JSON downloads.',
    },
    {
      href: '/research',
      icon: ICONS.research,
      name: 'Research Portal',
      desc: 'The latest AI research from arXiv, triaged against the Atlas and synthesized into threads.',
    },
    {
      href: '/scout',
      icon: ICONS.scout,
      name: 'Startup Scout',
      desc: 'Young AI companies as acquisition targets: discovered by vertical, evaluated, and tracked.',
    },
  ];

  return (
    <div className="lobby-page">
      <Header admin={admin} />
      <section className="wrap lobby-wrap" style={{ maxWidth: 1080 }}>
        <div className="lobby-hero">
          <h1 className="lobby-greeting">{greeting()}</h1>
          <p className="lobby-sub">Start with a question, or explore the Atlas below.</p>
          <LobbyAsk />
        </div>

        <div className="lobby-grid">
          {tiles.map((t, idx) => (
            <Link key={t.href} href={t.href} className="lobby-tile"
              style={{ animationDelay: `${idx * 55}ms` }}>
              <span className="lobby-tile-head">
                {t.icon}
                <span className="lobby-tile-name">{t.name}</span>
              </span>
              <span className="lobby-tile-desc">{t.desc}</span>
            </Link>
          ))}
        </div>

        {/* Upload entry, visible to everyone: the admin gets the live door to
            /ingest; everyone else sees the same button grayed (write access is
            the author's). The line beneath states what an upload becomes, and
            the admin desk links sit centered under it, label-free. */}
        <div className="lobby-upload">
          {personal ? (
            <Link href="/ingest" className="btn btn--ghost">Add a document to the Atlas</Link>
          ) : (
            <span
              className="btn btn--ghost"
              aria-disabled="true"
              title="Admin only"
              style={{ opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' }}
            >
              Add a document to the Atlas · Admin only
            </span>
          )}
          <p className="lobby-upload-note">
            PDFs and articles become sources, dossiers, and draft signals through the same pipeline.
          </p>
          {personal && counts && (
            <div className="lobby-admin">
              <Link href="/pipeline" className="btn btn--ghost btn--sm">
                Pipeline{counts.pipeline > 0 ? ` · ${counts.pipeline}` : ''}
              </Link>
              <Link href="/signals/drafts" className="btn btn--ghost btn--sm">
                Drafts{counts.drafts > 0 ? ` · ${counts.drafts}` : ''}
              </Link>
              <Link href="/research" className="btn btn--ghost btn--sm">
                Papers{counts.papers > 0 ? ` · ${counts.papers}` : ''}
              </Link>
              <Link href="/sources" className="btn btn--ghost btn--sm">Sources</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

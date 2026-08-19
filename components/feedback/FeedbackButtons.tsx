'use client';

import { useState } from 'react';
import type { TicketKind } from '@/lib/types';
import FeedbackDialog from '@/components/feedback/FeedbackDialog';

// The two feedback entry points: a beetle (report a bug) and a lightbulb
// (request a feature). variant='rail' renders the icon buttons for the
// sidebar's bottom island; variant='menu' renders text rows for the mobile
// hamburger sheet. Each instance owns its dialogs.

const BUG_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <ellipse cx="12" cy="13.5" rx="4.6" ry="5.5" />
    <path d="M12 8 v11" opacity="0.5" />
    <path d="M9.2 4.5a2.8 2.8 0 0 1 5.6 0" />
    <path d="M7.4 10.5 L3.8 8.5 M7.4 14 H3.4 M8 17 L4.8 19.5" />
    <path d="M16.6 10.5 L20.2 8.5 M16.6 14 H20.6 M16 17 L19.2 19.5" />
  </svg>
);

const IDEA_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9.5 18h5" />
    <path d="M10 21h4" />
    <path d="M8.5 14.5a5.5 5.5 0 1 1 7 0c-.9.8-1.5 1.4-1.5 2.5h-4c0-1.1-.6-1.7-1.5-2.5z" />
    <path d="M12 6.5v2M9 8l1 1.4M15 8l-1 1.4" opacity="0.6" />
  </svg>
);

export default function FeedbackButtons({ variant }: { variant: 'rail' | 'menu' }) {
  const [open, setOpen] = useState<TicketKind | null>(null);

  const dialogs = (
    <>
      <FeedbackDialog kind="bug" open={open === 'bug'} onClose={() => setOpen(null)} />
      <FeedbackDialog kind="feature" open={open === 'feature'} onClose={() => setOpen(null)} />
    </>
  );

  if (variant === 'menu') {
    // stopPropagation: the mobile sheet closes (and would unmount this
    // component, killing the open dialog) on any bubbled click.
    return (
      <>
        <button type="button" className="navmenu-item" onClick={(e) => { e.stopPropagation(); setOpen('bug'); }}>
          Report a bug
        </button>
        <button type="button" className="navmenu-item" onClick={(e) => { e.stopPropagation(); setOpen('feature'); }}>
          Request a feature
        </button>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="portal-rail-link"
        data-tip="Report a bug"
        aria-label="Report a bug"
        onClick={() => setOpen('bug')}
      >
        {BUG_ICON}
      </button>
      <button
        type="button"
        className="portal-rail-link"
        data-tip="Request a feature"
        aria-label="Request a feature"
        onClick={() => setOpen('feature')}
      >
        {IDEA_ICON}
      </button>
      {dialogs}
    </>
  );
}

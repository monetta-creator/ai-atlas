'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setTicketStatusAction, setTicketNoteAction, deleteTicketAction } from '@/lib/actions';
import type { Ticket } from '@/lib/types';

// One ticket on the admin desk: kind glyph, title, body, reporter email, the
// filing context, screenshots (served by the admin-gated image route), a status
// select, an admin note, and delete. All mutations are small server actions.

const KIND_GLYPH: Record<Ticket['kind'], string> = { bug: '🐛', feature: '✦' };
const STATUS_LABEL: Record<Ticket['status'], string> = {
  open: 'Open', in_progress: 'In progress', resolved: 'Resolved', declined: 'Declined',
};
const STATUS_COLOR: Record<Ticket['status'], string> = {
  open: 'var(--heat-2)', in_progress: 'var(--accent)', resolved: 'var(--supports)', declined: 'var(--faint-ink)',
};

export default function TicketRow({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(ticket.admin_note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-2"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', opacity: busy ? 0.6 : 1 }}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span aria-hidden="true" style={{ color: ticket.kind === 'feature' ? 'var(--accent)' : undefined }}>
          {KIND_GLYPH[ticket.kind]}
        </span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{ticket.title}</span>
        <span className="text-xs" style={{ color: STATUS_COLOR[ticket.status], fontFamily: 'var(--font-mono)' }}>
          {STATUS_LABEL[ticket.status]}
        </span>
        {ticket.severity && (
          <span className="text-xs" style={{ color: ticket.severity === 'blocking' ? 'var(--heat-4)' : 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
            {ticket.severity}
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          {ticket.created_at.slice(0, 10)}
        </span>
      </div>

      <p className="text-sm" style={{ color: 'var(--dim)', margin: 0, whiteSpace: 'pre-wrap' }}>{ticket.body}</p>

      <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--faint-ink)' }}>
        <a href={`mailto:${ticket.email}`} className="hover:underline" style={{ color: 'var(--accent)' }}>{ticket.email}</a>
        {ticket.page && <span>· from {ticket.page}</span>}
        {ticket.user_agent && (
          <span title={ticket.user_agent}>· {ticket.user_agent.includes('Mobile') ? 'mobile' : 'desktop'}</span>
        )}
      </div>

      {ticket.image_ids.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {ticket.image_ids.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setZoom(zoom === id ? null : id)}
              style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 0, background: 'none', cursor: 'zoom-in', overflow: 'hidden' }}
              aria-label={`Screenshot ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/tickets/image/${id}`} alt={`Screenshot ${i + 1}`}
                style={{ display: 'block', width: 96, height: 96, objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <button type="button" onClick={() => setZoom(null)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-out' }} aria-label="Close screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/tickets/image/${zoom}`} alt="Screenshot, enlarged"
            style={{ display: 'block', maxWidth: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }} />
        </button>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="input"
          style={{ width: 'auto', fontSize: 13, padding: '4px 8px' }}
          value={ticket.status}
          disabled={busy}
          onChange={(e) => void run(() => setTicketStatusAction(ticket.id, e.target.value))}
          aria-label="Status"
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setNoteOpen((o) => !o)}>
          {ticket.admin_note ? 'Note ·' : 'Add note'}
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          style={{ color: 'var(--heat-4)', marginLeft: 'auto' }}
          disabled={busy}
          onClick={() => { if (window.confirm('Delete this ticket for good?')) void run(() => deleteTicketAction(ticket.id)); }}
        >
          Delete
        </button>
      </div>

      {(noteOpen || (ticket.admin_note && noteOpen)) && (
        <div className="flex items-end gap-2">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor={`note-${ticket.id}`}>Admin note</label>
            <textarea id={`note-${ticket.id}`} className="input" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </div>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
            onClick={() => void run(() => setTicketNoteAction(ticket.id, note))}>
            Save
          </button>
        </div>
      )}
      {!noteOpen && ticket.admin_note && (
        <p className="text-xs" style={{ color: 'var(--dim)', margin: 0, fontStyle: 'italic' }}>{ticket.admin_note}</p>
      )}
    </div>
  );
}

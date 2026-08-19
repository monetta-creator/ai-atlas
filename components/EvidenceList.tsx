import Link from 'next/link';
import type { Evidence } from '@/lib/types';
import { directionLabel, directionColor, SIGNAL_LENS_LABEL } from '@/lib/format';

export default function EvidenceList({
  evidence,
  admin,
}: {
  evidence: Evidence[];
  admin: boolean;
}) {
  if (!evidence.length) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No evidence attached yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
      {evidence.map((ev) => (
        <li
          className="rounded-[var(--radius)] border p-3.5"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
          key={ev.id}
        >
          <div className="flex items-center flex-wrap gap-2 mb-1 text-xs">
            <span className={`font-medium ${directionColor(ev.direction)}`}>
              {directionLabel(ev.direction)}
            </span>
            <span style={{ color: 'var(--faint-ink)' }}>· weight {ev.weight}</span>
            {ev.source_title && (
              <span style={{ color: 'var(--faint-ink)' }}>
                · {ev.source_title}
                {ev.source_outlet ? ` (${ev.source_outlet})` : ''}
              </span>
            )}
            {ev.signal_id && ev.signal_title && (
              <span style={{ color: 'var(--faint-ink)' }}>
                · via{' '}
                <Link href={`/signals/${ev.signal_id}`} style={{ color: 'var(--accent)' }}>
                  {ev.signal_title}
                </Link>
              </span>
            )}
            {ev.lens && (
              <span style={{ color: 'var(--faint-ink)' }}>· {SIGNAL_LENS_LABEL[ev.lens]}</span>
            )}
            {admin && ev.reliability_prior != null && (
              <span style={{ color: 'var(--faint-ink)' }}>· prior {ev.reliability_prior}</span>
            )}
          </div>
          {ev.excerpt && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>{ev.excerpt}</p>
          )}
          {admin && ev.note && (
            <p className="text-xs mt-1 italic" style={{ color: 'var(--faint-ink)' }}>{ev.note}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

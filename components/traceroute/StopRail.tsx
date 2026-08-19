'use client';

import { MOVEMENTS } from '@/lib/traceroute/movements';
import type { MovementId } from '@/lib/traceroute/movements';

// Four items, not eleven. The rail exists so a reader knows how far in they are and can get
// back out, which is a job four entries do better than a numbered index of every place the
// journey passes through.

export default function StopRail({
  active,
  onJump,
}: {
  active: MovementId;
  onJump: (id: MovementId) => void;
}) {
  const activeIndex = MOVEMENTS.findIndex((m) => m.id === active);

  return (
    <nav className="tr-rail" aria-label="Sections">
      <div className="tr-rail-inner">
        <ol className="tr-rail-list">
          {MOVEMENTS.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className="tr-rail-item"
                data-active={m.id === active ? '' : undefined}
                data-passed={i < activeIndex ? '' : undefined}
                onClick={() => onJump(m.id)}
              >
                <span className="tr-rail-tick" aria-hidden="true" />
                <span className="tr-rail-title">{m.short}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

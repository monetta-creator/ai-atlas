'use client';

import type { AskConvo } from '@/components/ask/store';

// The conversation rail: browser-local history, newest first. Rendered in the
// left grid column on desktop and inside the left sheet on mobile.
export default function AskRail({
  convos, activeId, onSelect, onNew, onDelete,
}: {
  convos: AskConvo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="ask-rail-brand">Ask the Atlas</div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onNew} style={{ marginBottom: 10 }}>
        + New chat
      </button>
      {convos.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--faint-ink)', padding: '4px 8px', lineHeight: 1.6 }}>
          Conversations are saved in this browser only.
        </p>
      )}
      {convos.map((c) => (
        <div
          key={c.id}
          className="ask-convo"
          data-active={c.id === activeId ? '' : undefined}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(c.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id); }
          }}
        >
          <span className="ask-convo-title" title={c.title}>{c.title}</span>
          <button
            type="button"
            className="ask-convo-del"
            aria-label="Delete conversation"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Delete this conversation?')) onDelete(c.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ElementType, JSX } from 'react';
import { saveContentAction, type SaveContentState } from '@/lib/actions';

// Admin click-to-edit. Renders plain text unless `editing` (which the server sets to
// admin && edit-mode cookie). In edit mode the text gets a dashed outline; clicking
// opens an inline editor that saves the override via saveContentAction. Guests never
// get here (editing is false) and the action re-checks requireAdmin() regardless.
type Props = {
  k: string;
  value: string; // already override-or-fallback resolved by txt()
  editing: boolean;
  as?: keyof JSX.IntrinsicElements;
  multiline?: boolean;
  className?: string;
  style?: CSSProperties;
};

export default function Editable({
  k,
  value,
  editing,
  as = 'span',
  multiline = false,
  className,
  style,
}: Props) {
  const Tag = as as ElementType;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, formAction, pending] = useActionState<SaveContentState, FormData>(
    saveContentAction,
    { ok: true }
  );
  const prevPending = useRef(false);

  // Collapse the editor on the pending true -> false edge, but only if the save passed.
  // (The draft is re-seeded from `value` each time the editor opens, so no value-sync
  // effect is needed; after a successful save the editor closes and the fresh `value`
  // shows in the closed state.)
  useEffect(() => {
    if (prevPending.current && !pending && state.ok) setOpen(false);
    prevPending.current = pending;
  }, [pending, state.ok]);

  if (!editing) {
    return (
      <Tag className={className} style={style}>
        {value}
      </Tag>
    );
  }

  if (!open) {
    const openEditor = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      // Stop navigation when an Editable sits inside a <Link> (e.g. the hub cards).
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
      setOpen(true);
    };
    return (
      <Tag
        className={className}
        style={style}
        data-editable=""
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={openEditor}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') openEditor(e);
        }}
      >
        {value}
        <span className="editable-pencil" aria-hidden>✎</span>
      </Tag>
    );
  }

  return (
    <form action={formAction} className="editable-form">
      <input type="hidden" name="key" value={k} />
      {multiline ? (
        <textarea
          name="value"
          className="input"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ resize: 'vertical' }}
          autoFocus
        />
      ) : (
        <input
          name="value"
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      )}
      <div className="editable-actions">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          Cancel
        </button>
        {!state.ok && state.error && (
          <span className="editable-error" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

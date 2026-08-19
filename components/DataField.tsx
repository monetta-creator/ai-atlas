'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { updateDomainFieldAction, type UpdateFieldState } from '@/lib/actions';

// Admin click-to-edit for one domain-table field on /data. Posts table/id/column/value
// to updateDomainFieldAction, which writes straight to the row. Closed state shows the
// value with a dashed affordance; clicking opens an inline editor. This mirrors
// Editable.tsx, but Editable writes content_blocks overrides — this writes the records
// themselves, so it is a separate component on purpose.
type Props = {
  table: string;
  id: string;
  column: string;
  value: string | null;
  label: string;
  required?: boolean;
  multiline?: boolean;
};

export default function DataField({
  table,
  id,
  column,
  value,
  label,
  required = false,
  multiline = false,
}: Props) {
  const current = value ?? '';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [state, formAction, pending] = useActionState<UpdateFieldState, FormData>(
    updateDomainFieldAction,
    { ok: true }
  );
  const prevPending = useRef(false);

  // Collapse the editor on the pending true -> false edge, but only if the save passed.
  // The draft re-seeds from `current` each time the editor opens, and after a successful
  // save revalidatePath re-renders this with the fresh `value` prop.
  useEffect(() => {
    if (prevPending.current && !pending && state.ok) setOpen(false);
    prevPending.current = pending;
  }, [pending, state.ok]);

  const labelEl = (
    <span className="datafield__label">
      {label}
      {required ? ' *' : ''}
    </span>
  );

  if (!open) {
    const openEditor = () => {
      setDraft(current);
      setOpen(true);
    };
    return (
      <div className="datafield">
        {labelEl}
        <span
          className="datafield__value"
          data-editable=""
          role="button"
          tabIndex={0}
          title="Click to edit"
          onClick={openEditor}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEditor();
            }
          }}
        >
          {current || <span className="datafield__empty">(empty)</span>}
          <span className="editable-pencil" aria-hidden>✎</span>
        </span>
      </div>
    );
  }

  return (
    <div className="datafield">
      {labelEl}
      <form action={formAction} className="editable-form">
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="column" value={column} />
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
              setDraft(current);
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
    </div>
  );
}

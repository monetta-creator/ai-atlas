'use client';

import { useState } from 'react';
import { updatePositionStatementAction } from '@/lib/actions';

// Inline edit toggle for a cross-cutting position's statement. The save posts to a
// redirect action, so on success the page reloads with the new text; the only client
// state is open/closed.
export default function PositionStatementEditor({ id, statement }: { id: string; statement: string }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="wv-statement">
        <p>{statement}</p>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <form action={updatePositionStatementAction} className="editable-form">
      <input type="hidden" name="id" value={id} />
      <textarea
        name="statement"
        className="input"
        rows={3}
        defaultValue={statement}
        style={{ resize: 'vertical' }}
        autoFocus
      />
      <div className="editable-actions">
        <button type="submit" className="btn btn--primary btn--sm">Save</button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

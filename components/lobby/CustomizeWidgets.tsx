'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WIDGET_CATALOG, widgetMeta } from '@/lib/widgets/catalog';
import { saveHomeWidgetsAction } from '@/lib/actions';

// Immutable adjacent-swap reorder; the ↑/↓ fallback to drag-and-drop.
function moveUp(list: string[], idx: number): string[] {
  if (idx <= 0) return list;
  const next = [...list];
  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
  return next;
}

function moveDown(list: string[], idx: number): string[] {
  if (idx < 0 || idx >= list.length - 1) return list;
  const next = [...list];
  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  return next;
}

// Admin-only Lobby control: reorder, add, and remove board widgets, then
// save through the guarded action. Collapsed to a single button so the
// board itself stays the focus; the working list is local state seeded
// fresh from `active` every time the panel opens.
export default function CustomizeWidgets({ active }: { active: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>(active);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openPanel() {
    setList([...active]);
    setDragIndex(null);
    setError(null);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    setDragIndex(null);
    setError(null);
  }

  function remove(idx: number) {
    setList((prev) => prev.filter((_, i) => i !== idx));
  }

  function add(key: string) {
    setList((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function dropOn(idx: number) {
    setList((prev) => {
      if (dragIndex === null || dragIndex === idx) return prev;
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIndex(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveHomeWidgetsAction(list);
        router.refresh();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save the board.');
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--sm" onClick={openPanel}>
        Customize
      </button>
    );
  }

  const available = WIDGET_CATALOG.filter((w) => !list.includes(w.key));

  return (
    <div className="lwc-panel">
      <div className="lw-head">On the board</div>
      {list.map((key, idx) => {
        const meta = widgetMeta(key);
        if (!meta) return null;
        const spanNote = meta.span === 3 ? 'full' : meta.span === 2 ? 'wide' : null;
        return (
          <div
            key={key}
            className="lwc-row"
            draggable
            data-dragging={dragIndex === idx ? 'true' : undefined}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(idx)); setDragIndex(idx); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); dropOn(idx); }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="lwc-handle" aria-hidden="true">⠿</span>
            <span className="lwc-name">
              {meta.name}
              {spanNote && <span className="lwc-chip">{spanNote}</span>}
              {meta.access === 'admin' && <span className="lwc-chip">admin</span>}
            </span>
            <button
              type="button" className="lwc-btn" disabled={idx === 0}
              onClick={() => setList((prev) => moveUp(prev, idx))} aria-label={`Move ${meta.name} up`}
            >↑</button>
            <button
              type="button" className="lwc-btn" disabled={idx === list.length - 1}
              onClick={() => setList((prev) => moveDown(prev, idx))} aria-label={`Move ${meta.name} down`}
            >↓</button>
            <button
              type="button" className="lwc-btn"
              onClick={() => remove(idx)} aria-label={`Remove ${meta.name}`}
            >✕</button>
          </div>
        );
      })}

      <div className="lw-head" style={{ marginTop: 14 }}>Add a widget</div>
      {available.length === 0 ? (
        <p className="lwc-add-desc">Every widget is already on the board.</p>
      ) : (
        available.map((w) => (
          <div key={w.key} className="lwc-row">
            <span className="lwc-name">
              {w.name}
              {w.access === 'admin' && <span className="lwc-chip">admin</span>}
            </span>
            <span className="lwc-add-desc">{w.desc}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => add(w.key)}>Add</button>
          </div>
        ))
      )}

      {error && <p className="lwc-err">{error}</p>}
      <div className="lwc-actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={closePanel} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={pending || list.length === 0}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

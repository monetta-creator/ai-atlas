'use client';

import { useEffect, useState } from 'react';
import {
  describeState, fromViewParams, toViewParams,
  type BuilderState, type ColType,
} from '@/lib/datasets/query-url';
import type { DatasetDef } from '@/lib/datasets/core';

// Saved views (migration 0064), the builder-side panel: a save form over the
// current builder state, plus the list of views this identity may read for
// this dataset. The API is the source of truth for who may read/write a view
// (lib/portal/views-core.ts canReadView/canWriteView on the server; this
// panel has no ownership marker to key off client-side, since the GET
// envelope carries no `mine`/`canWrite` field), so this renders one list
// (a "shared" badge marks a team view) rather than guessing a My/Team split,
// and shows Rename/Delete on every row: a row the caller cannot write 404s
// with "Unknown view." (the same no-oracle answer the API gives a probing
// request), surfaced here as this row's own inline error rather than a UI
// guess about ownership.

interface SavedView {
  id: string;
  key_id: string | null;
  owner: 'key' | 'legacy' | 'admin';
  dataset_slug: string;
  name: string;
  spec: Record<string, string | string[]>;
  format: 'csv' | 'json';
  is_shared: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// The column shape fromViewParams needs (lib/datasets/query-url.ts's
// FilterableDef): just key + type, so QueryBuilder's own QueryColumn[]
// (label/def/values along for the ride) satisfies it with no conversion.
type ColumnLike = { key: string; type: ColType };

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body: { error?: string; message?: string } = await res.json();
    // The portal 401 envelope is { error: 'key_required'|'key_expired'|
    // 'key_revoked', message: <human text> } (lib/portal/identity.ts
    // unauthorizedMessage); the human sentence is what belongs on screen.
    return body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

type ListState =
  | { key: string; status: 'ok'; views: SavedView[] }
  | { key: string; status: 'error'; message: string };

export default function SavedViews({
  slug, unlocked, state, onLoad, format, columns, filters,
}: {
  slug: string;
  unlocked: boolean;
  state: BuilderState;
  onLoad: (state: BuilderState, view: SavedView) => void;
  format: 'csv' | 'json';
  columns: ColumnLike[];
  filters: DatasetDef['filters'];
}) {
  // Loading is DERIVED (the AskPeek idiom): a request key bumps on refresh, a
  // result carries the key it belongs to, and status is read off whether the
  // latest result matches the latest key. No setState ever runs synchronously
  // in the effect body (the React Compiler's set-state-in-effect rule).
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ListState | null>(null);
  const listKey = `${slug}:${refresh}`;

  useEffect(() => {
    if (!unlocked) return;
    const ac = new AbortController();
    let live = true;
    fetch(`/api/portal/views?dataset=${encodeURIComponent(slug)}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorFrom(res, `Could not load saved views (status ${res.status}).`));
        return res.json() as Promise<{ views: SavedView[] }>;
      })
      .then((data) => { if (live) setResult({ key: listKey, status: 'ok', views: data.views ?? [] }); })
      .catch((e: Error) => {
        if (!live || e.name === 'AbortError') return;
        setResult({ key: listKey, status: 'error', message: e.message || 'Could not load saved views.' });
      });
    return () => { live = false; ac.abort(); };
  }, [listKey, slug, unlocked]);

  const current = result && result.key === listKey ? result : null;
  const listStatus: 'loading' | 'error' | 'ok' = !current ? 'loading' : current.status;

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [share, setShare] = useState(true);
  const [saveState, setSaveState] = useState<{ status: 'idle' | 'saving' } | { status: 'error'; message: string }>({ status: 'idle' });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!unlocked) return null;

  async function submitSave(e: React.FormEvent) {
    e.preventDefault();
    if (saveState.status === 'saving') return;
    if (!name.trim()) {
      setSaveState({ status: 'error', message: 'Name the view first.' });
      return;
    }
    setSaveState({ status: 'saving' });
    try {
      const res = await fetch('/api/portal/views', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          dataset_slug: slug, name: name.trim(), params: toViewParams(state), format, is_shared: share,
        }),
      });
      if (!res.ok) {
        setSaveState({ status: 'error', message: await errorFrom(res, `Could not save the view (status ${res.status}).`) });
        return;
      }
      setSaveState({ status: 'idle' });
      setFormOpen(false);
      setName('');
      setShare(true);
      setRefresh((n) => n + 1);
    } catch {
      setSaveState({ status: 'error', message: 'Could not save the view.' });
    }
  }

  function startRename(view: SavedView) {
    setRenamingId(view.id);
    setRenameValue(view.name);
    setRowError(null);
  }

  async function submitRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRowError({ id, message: 'Name the view first.' }); return; }
    setBusyId(id);
    try {
      const res = await fetch(`/api/portal/views/${id}`, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setRowError({ id, message: await errorFrom(res, `Could not rename (status ${res.status}).`) });
        return;
      }
      setRenamingId(null);
      setRefresh((n) => n + 1);
    } catch {
      setRowError({ id, message: 'Could not rename the view.' });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/portal/views/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setRowError({ id, message: await errorFrom(res, `Could not delete (status ${res.status}).`) });
        setDeleteConfirmId(null);
        return;
      }
      setDeleteConfirmId(null);
      setRefresh((n) => n + 1);
    } catch {
      setRowError({ id, message: 'Could not delete the view.' });
      setDeleteConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  function copyLink(view: SavedView) {
    // No &format= override: the download route already applies the view's
    // own stored format when ?view= is present and format is absent
    // (lib/portal/views-core.ts mergeParams), so the explicit param here was
    // always redundant with what the link already does.
    const href = `/api/datasets/${slug}?view=${view.id}`;
    const abs = `${window.location.origin}${href}`;
    navigator.clipboard?.writeText(abs)
      .then(() => { setCopiedId(view.id); setTimeout(() => setCopiedId(null), 1500); })
      .catch(() => {});
  }

  function loadView(view: SavedView) {
    onLoad(fromViewParams(view.spec, { columns, filters }), view);
  }

  return (
    <div className="dp-qb-section dp-views">
      <div className="dp-qb-label">Saved views</div>

      <div className="dp-views-save">
        {formOpen ? (
          <form className="dp-views-form" onSubmit={(e) => void submitSave(e)}>
            <input
              className="input" type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name this view" maxLength={80} aria-label="View name" autoFocus
            />
            <label className="dp-views-share">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              Share with the team
            </label>
            <div className="dp-views-formactions">
              <button type="submit" className="btn btn--primary btn--sm" disabled={saveState.status === 'saving'}>
                {saveState.status === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button" className="btn btn--quiet btn--sm"
                onClick={() => { setFormOpen(false); setSaveState({ status: 'idle' }); }}
              >
                Cancel
              </button>
            </div>
            {saveState.status === 'error' && <p className="dp-qb-hint dp-qb-hint--error">{saveState.message}</p>}
          </form>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFormOpen(true)}>
            Save view
          </button>
        )}
      </div>

      {listStatus === 'loading' && <p className="dp-qb-hint">Loading saved views…</p>}
      {listStatus === 'error' && current?.status === 'error' && (
        <p className="dp-qb-hint dp-qb-hint--error">{current.message}</p>
      )}
      {listStatus === 'ok' && current?.status === 'ok' && (
        current.views.length === 0 ? (
          <p className="dp-qb-hint">No saved views yet for this dataset.</p>
        ) : (
          <ul className="dp-views-list">
            {current.views.map((view) => (
              <li key={view.id} className="dp-views-row">
                {renamingId === view.id ? (
                  <form
                    className="dp-views-rename"
                    onSubmit={(e) => { e.preventDefault(); void submitRename(view.id); }}
                  >
                    <input
                      className="input" type="text" value={renameValue} maxLength={80}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setRenamingId(null); }}
                      aria-label={`Rename ${view.name}`} autoFocus
                    />
                    <button type="submit" className="btn btn--quiet btn--sm" disabled={busyId === view.id}>
                      Save
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="dp-views-name">
                      {view.name}
                      {view.is_shared && <span className="badge dp-views-badge">shared</span>}
                    </div>
                    <p className="dp-views-desc">{describeState(fromViewParams(view.spec, { columns, filters }))}</p>
                    <div className="dp-views-meta">
                      used {view.use_count}×{view.last_used_at ? ` · last ${view.last_used_at.slice(0, 10)}` : ''}
                    </div>
                    <div className="dp-views-actions">
                      <button type="button" className="btn btn--quiet btn--sm" onClick={() => loadView(view)}>
                        Load
                      </button>
                      <button type="button" className="btn btn--quiet btn--sm" onClick={() => copyLink(view)}>
                        {copiedId === view.id ? 'Copied' : 'Copy download link'}
                      </button>
                      <button type="button" className="btn btn--quiet btn--sm" onClick={() => startRename(view)}>
                        Rename
                      </button>
                      {deleteConfirmId === view.id ? (
                        <>
                          <button
                            type="button" className="btn btn--quiet btn--sm dp-views-danger"
                            onClick={() => void confirmDelete(view.id)} disabled={busyId === view.id}
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button" className="btn btn--quiet btn--sm"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button" className="btn btn--quiet btn--sm"
                          onClick={() => { setDeleteConfirmId(view.id); setRowError(null); }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    {rowError?.id === view.id && <p className="dp-qb-hint dp-qb-hint--error">{rowError.message}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

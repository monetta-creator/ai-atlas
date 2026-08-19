'use client';

import { useRef, useState } from 'react';

function ToolBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// One shared formatting toolbar for all the editable narrative fields. execCommand acts on
// the document's live selection, so a single toolbar serves whichever field is focused.
// Buttons preventDefault on mousedown to keep that selection (focus stays in the editor).
// Supports bold/italic, bulleted lists, and hyperlink add/edit/remove.
export default function EditorToolbar() {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  }
  function anchorInSelection(): HTMLAnchorElement | null {
    let n: Node | null = window.getSelection()?.anchorNode ?? null;
    while (n) {
      if (n.nodeType === 1 && (n as Element).tagName === 'A') return n as HTMLAnchorElement;
      n = n.parentNode;
    }
    return null;
  }
  function selectNode(node: Node) {
    const r = document.createRange();
    r.selectNode(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function openLink() {
    saveSelection();
    setUrl(anchorInSelection()?.getAttribute('href') ?? '');
    setLinkOpen(true);
  }
  function applyLink() {
    restoreSelection();
    const existing = anchorInSelection();
    if (existing) selectNode(existing); // editing: replace the whole anchor's href
    const href = url.trim();
    if (href) exec('createLink', href);
    setLinkOpen(false);
    setUrl('');
  }
  function removeLink() {
    const existing = anchorInSelection();
    if (existing) selectNode(existing);
    exec('unlink');
  }

  return (
    <div className="editor-toolbar">
      <ToolBtn label="B" title="Bold" onClick={() => exec('bold')} />
      <ToolBtn label="I" title="Italic" onClick={() => exec('italic')} />
      <ToolBtn label="• List" title="Bulleted list" onClick={() => exec('insertUnorderedList')} />
      <ToolBtn label="Link" title="Add or edit link (select text first)" onClick={openLink} />
      <ToolBtn label="Unlink" title="Remove link" onClick={() => { saveSelection(); removeLink(); }} />
      {linkOpen && (
        <span className="editor-link-row">
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or /claim/3.3"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { setLinkOpen(false); setUrl(''); }
            }}
          />
          <button type="button" className="btn btn--ghost btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>
            Apply
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => { setLinkOpen(false); setUrl(''); }}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

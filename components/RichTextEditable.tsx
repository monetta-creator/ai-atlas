'use client';

import { useEffect, useRef } from 'react';

// A minimal rich-text field built directly on contentEditable — no editor library (the
// lightest possible "editor"). Formatting (bold/italic/lists/links) is driven by the
// shared EditorToolbar via document.execCommand on the live selection. The field is
// UNCONTROLLED: it sets innerHTML once on mount and reports changes up via onChange, so
// typing never resets the caret. To load fresh content (e.g. after regeneration) the
// parent gives it a new `key`, which remounts it with the new initialHtml.
export default function RichTextEditable({
  initialHtml,
  onChange,
  ariaLabel,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Mount-only: seed the editable region. Intentionally not reactive to initialHtml (a
  // re-seed would clobber the caret); remount via `key` to load new content.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      className="report-prose report-editable"
      onInput={() => onChange(ref.current?.innerHTML ?? '')}
      // Paste as plain text: keeps the markup clean and blocks pasted scripts/markup.
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}

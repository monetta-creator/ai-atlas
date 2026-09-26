'use client';

import { useFormStatus } from 'react-dom';
import { saveSavantPrefsAction } from '@/lib/actions';
import type { SavantPrefs } from '@/lib/savant/types';

function SubmitRow() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn--primary btn--sm" disabled={pending}
        style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}>
        {pending ? 'Saving…' : 'Save preferences'}
      </button>
    </div>
  );
}

// Savant's runtime switches: on/off, the three model picks, the editor's
// byline, the lead-topic rotation, an override, and email. Posts straight to
// saveSavantPrefsAction, which validates and revalidates this page; no client
// dirty-tracking, unlike the tooling console's picker (Savant's knobs are
// text, not numeric thresholds worth guarding against an accidental save).
export default function SavantPrefsForm({ prefs }: { prefs: SavantPrefs }) {
  return (
    <form action={saveSavantPrefsAction} className="sv-prefs">
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" name="enabled" defaultChecked={prefs.enabled} />
        Enabled
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          (pauses the weekday notebook pass and the Friday issue)
        </span>
      </label>

      <div className="flex items-end gap-4" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="sv-writer">Writer model</label>
          <input id="sv-writer" name="writer_model" className="input" defaultValue={prefs.writer_model} required />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="sv-editor">Editor model</label>
          <input id="sv-editor" name="editor_model" className="input" defaultValue={prefs.editor_model} required />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="sv-notebook">Notebook model</label>
          <input id="sv-notebook" name="notebook_model" className="input" defaultValue={prefs.notebook_model} required />
        </div>
      </div>

      <div className="field">
        <label htmlFor="sv-editor-name">Editor&apos;s byline</label>
        <input id="sv-editor-name" name="editor_name" className="input" defaultValue={prefs.editor_name} />
      </div>

      <div className="flex items-end gap-4" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 320, flex: 1 }}>
          <label htmlFor="sv-rotation">Lead-topic rotation (comma-separated lens slugs)</label>
          <input id="sv-rotation" name="lead_rotation" className="input"
            defaultValue={prefs.lead_rotation.join(', ')} />
        </div>
        <div className="field" style={{ minWidth: 180 }}>
          <label htmlFor="sv-override">Lead override</label>
          <input id="sv-override" name="lead_override" className="input"
            defaultValue={prefs.lead_override ?? ''} placeholder="empty = none" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" name="email_enabled" defaultChecked={prefs.email_enabled} />
        Email the Friday issue
      </label>

      <SubmitRow />
    </form>
  );
}

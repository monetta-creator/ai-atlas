'use client';

import type { ReactNode } from 'react';
import { SIGNAL_LENS_LABEL, signalLensColor, formatDateRange } from '@/lib/format';
import type { Report, SignalLens } from '@/lib/types';
import RichTextEditable from './RichTextEditable';
import EditorToolbar from './EditorToolbar';

// The generated report, in display order: header, macro survey, claims recap, lens-by-lens
// breakdown. (The page renders the read-only appendices below this.) Every narrative
// section is a fully-editable rich-text field (HTML), plus one editable/removable plain-text
// CALLOUT (the section's key takeaway, rendered as a callout box in the PDF). Edits flow up
// via onEditSection / onEditCallout so the held Report — what Phase 4 exports — stays in
// sync. Export to PDF triggers the browser print path (onExport).

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>{children}</p>;
}

// Per-section callout editor: a single-line takeaway with a Remove control, or an "Add
// callout" affordance when there is none. `value` null/undefined = no callout.
function CalloutEditor({
  value,
  onChange,
  onRemove,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  if (value === null || value === undefined) {
    return (
      <button type="button" className="btn btn--quiet btn--sm" style={{ marginTop: 6 }} onClick={() => onChange('')}>
        + Add callout
      </button>
    );
  }
  return (
    <div className="callout-edit">
      <span className="callout-edit-tag" title="Shown as a highlighted callout box in the PDF, the section's key takeaway">
        Callout
      </span>
      <input
        className="input"
        value={value}
        placeholder="One-line key takeaway for the callout box…"
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="btn btn--quiet btn--sm" onClick={onRemove}>Remove</button>
    </div>
  );
}

export default function ReportDocument({
  report,
  title,
  onTitleChange,
  onSave,
  saving,
  saved,
  onResynthesize,
  resynthesizing,
  onExport,
  onEditSection,
  onEditCallout,
  lensErrors,
  onRetryLens,
  retrying,
}: {
  report: Report;
  title: string;
  onTitleChange: (t: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  onResynthesize: () => void;
  resynthesizing: boolean;
  onExport: () => void;
  onEditSection: (key: string, html: string) => void;
  onEditCallout: (key: string, value: string | null) => void;
  lensErrors: Record<string, string>;
  onRetryLens: (lens: SignalLens) => void;
  retrying: SignalLens | null;
}) {
  const { narrative, range, lenses, generatedAt } = report;
  // Stable per-generation key so editors persist across keystrokes but remount (reload
  // fresh content) on a new generation.
  const ekey = (k: string) => `${generatedAt}:${k}`;
  const when = `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 16)} UTC`;

  const callout = (key: string) => (
    <CalloutEditor
      value={narrative.callouts[key]}
      onChange={(v) => onEditCallout(key, v)}
      onRemove={() => onEditCallout(key, null)}
    />
  );

  return (
    <div style={{ marginTop: 24 }}>
      {/* Header: editable title + actions (save / export / re-synthesize) */}
      <header
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div>
          <input
            className="input"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Editorial title"
            placeholder="Editorial title (the report headline)"
            style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600 }}
          />
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--dim)' }}>
            AI Atlas Report · {formatDateRange(range.from, range.to)} · {lenses.length} lens{lenses.length === 1 ? '' : 'es'} · generated {when}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn btn--primary" onClick={onSave} disabled={saving}
            style={saving ? { opacity: 0.6, cursor: 'wait' } : undefined}>
            {saving ? 'Saving…' : saved ? 'Update' : 'Save'}
          </button>
          {saved && !saving && <span className="text-xs" style={{ color: 'var(--supports)' }}>✓ saved</span>}
          <button type="button" className="btn btn--ghost" onClick={onExport}
            title="Open the browser print / Save-as-PDF dialog (formatting + clickable links preserved)">
            Export to PDF
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onResynthesize} disabled={resynthesizing}
            style={resynthesizing ? { opacity: 0.6, cursor: 'wait' } : undefined}
            title="Re-run the macro survey + claims recap from the current lens text">
            {resynthesizing ? 'Re-synthesizing…' : 'Re-synthesize overview'}
          </button>
        </div>
      </header>

      {/* Shared formatting toolbar for every editable section below */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, marginTop: 14 }}>
        <EditorToolbar />
      </div>

      {/* Period summary (the cross-lens overview; was "Macro survey") */}
      <section style={{ marginTop: 14 }}>
        <div className="section-label">Period summary</div>
        {narrative.macroSurvey ? (
          <RichTextEditable
            key={ekey('macroSurvey')}
            initialHtml={narrative.macroSurvey}
            ariaLabel="Period summary"
            onChange={(html) => onEditSection('macroSurvey', html)}
          />
        ) : (
          <Muted>Synthesis did not produce a period summary.</Muted>
        )}
      </section>

      {/* Claims recap */}
      <section style={{ marginTop: 18 }}>
        <div className="section-label">Claims recap</div>
        {narrative.claimsRecap ? (
          <RichTextEditable
            key={ekey('claimsRecap')}
            initialHtml={narrative.claimsRecap}
            ariaLabel="Claims recap"
            onChange={(html) => onEditSection('claimsRecap', html)}
          />
        ) : (
          <Muted>Synthesis did not produce a claims recap.</Muted>
        )}
      </section>

      {/* Lens-by-lens breakdown — each lens has one callout (the key takeaway), which the
          PDF gathers into the summary-page grid */}
      <div className="section-label" style={{ marginTop: 22 }}>Lens-by-lens breakdown</div>
      {lenses.map((lens) => {
        const html = narrative.perLens[lens];
        const err = lensErrors[lens];
        return (
          <section key={lens} style={{ marginTop: 14 }}>
            <div className="section-label" style={{ color: signalLensColor(lens) }}>
              {SIGNAL_LENS_LABEL[lens]}
            </div>
            {html ? (
              <>
                {callout(lens)}
                <RichTextEditable
                  key={ekey(`lens:${lens}`)}
                  initialHtml={html}
                  ariaLabel={`${SIGNAL_LENS_LABEL[lens]} narrative`}
                  onChange={(h) => onEditSection(`lens:${lens}`, h)}
                />
              </>
            ) : err ? (
              <div
                className="flex items-center justify-between flex-wrap gap-3 rounded-[var(--radius)] border p-[var(--card-pad)]"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                <span className="text-sm" style={{ color: 'var(--heat-4)' }}>
                  Couldn’t generate this lens: {err}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onRetryLens(lens)}
                  disabled={retrying === lens}
                  style={retrying === lens ? { opacity: 0.6, cursor: 'wait' } : undefined}
                >
                  {retrying === lens ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            ) : (
              <Muted>No developments under this lens in this period.</Muted>
            )}
          </section>
        );
      })}
    </div>
  );
}

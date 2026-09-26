'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveSavantPrefsAction } from '@/lib/actions';
import type { SavantPrefs } from '@/lib/savant/types';
import {
  SAVANT_MODEL_OPTIONS, TIER_LABEL, estimateSavantWeek, fmtUsd, isAnthropicId, LEAD_FALLBACK_MODEL,
  type RateTable, type SavantRole,
} from '@/lib/savant/cost-model';

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

const ROLE_LABEL: Record<SavantRole, string> = { writer: 'Writer', editor: 'Editor', notebook: 'Notebook' };

// One model picker: the catalog grouped by tier (Anthropic, open-weight
// reasoning, open-weight flash), plus
// the saved id as a lone option when it is not in the catalog, so an id set
// by SQL never disappears on save.
function ModelSelect({ id, name, value, rates, onChange }: {
  id: string; name: string; value: string; rates: RateTable; onChange: (v: string) => void;
}) {
  const tiers = [...new Set(SAVANT_MODEL_OPTIONS.map((m) => m.tier))];
  const known = SAVANT_MODEL_OPTIONS.some((m) => m.id === value);
  return (
    <select id={id} name={name} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value} (not in the catalog)</option>}
      {tiers.map((tier) => (
        <optgroup key={tier} label={TIER_LABEL[tier]}>
          {SAVANT_MODEL_OPTIONS.filter((m) => m.tier === tier).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}{m.tier !== 'anthropic' ? ` · ${m.vendor}` : ''}{rates[m.id] ? '' : ' (no rate card)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Savant's runtime switches: on/off, the three model picks with a live cost
// estimate for the week (the token profile measured on the 09-25 review
// runs, priced on the live rate cards), the editor's byline, the lead-topic
// rotation, an override, and email. Posts straight to saveSavantPrefsAction,
// which validates and revalidates this page.
export default function SavantPrefsForm({ prefs, rates }: { prefs: SavantPrefs; rates: RateTable }) {
  const [writer, setWriter] = useState(prefs.writer_model);
  const [editor, setEditor] = useState(prefs.editor_model);
  const [notebook, setNotebook] = useState(prefs.notebook_model);

  const picked = estimateSavantWeek({ writer, editor, notebook }, rates);
  const saved = estimateSavantWeek({ writer: prefs.writer_model, editor: prefs.editor_model, notebook: prefs.notebook_model }, rates);
  const delta = picked.total - saved.total;
  const changed = writer !== prefs.writer_model || editor !== prefs.editor_model || notebook !== prefs.notebook_model;
  const leadFallsBack = !isAnthropicId(writer);

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
          <ModelSelect id="sv-writer" name="writer_model" value={writer} rates={rates} onChange={setWriter} />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="sv-editor">Editor model</label>
          <ModelSelect id="sv-editor" name="editor_model" value={editor} rates={rates} onChange={setEditor} />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="sv-notebook">Notebook model</label>
          <ModelSelect id="sv-notebook" name="notebook_model" value={notebook} rates={rates} onChange={setNotebook} />
        </div>
      </div>

      <div className="sv-cost">
        <div className="sv-cost-head">
          <span className="sv-cost-kicker">Estimated cost per issue week</span>
          <span className="sv-cost-total">
            {fmtUsd(picked.total)}
            {changed && (
              <span className="sv-cost-delta" data-sign={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}>
                {' '}{delta >= 0 ? '+' : '-'}{fmtUsd(Math.abs(delta))} vs saved
              </span>
            )}
          </span>
        </div>
        <table className="sv-cost-table">
          <thead>
            <tr><th>Leg</th><th>Role</th><th>Model</th><th style={{ textAlign: 'right' }}>USD</th></tr>
          </thead>
          <tbody>
            {picked.legs.map((l) => (
              <tr key={l.leg}>
                <td>{l.leg}</td>
                <td>{ROLE_LABEL[l.role]}</td>
                <td className="sv-cost-model">{l.model}{l.fallback ? ' (Anthropic-only leg)' : ''}</td>
                <td style={{ textAlign: 'right' }}>{fmtUsd(l.usd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                Writer {fmtUsd(picked.byRole.writer)} · Editor {fmtUsd(picked.byRole.editor)} · Notebook {fmtUsd(picked.byRole.notebook)}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtUsd(picked.total)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="sv-cost-note">
          Token profile measured on the 09-25 issue (about 78k input, 9k cached, 16k output across 18 calls), priced on the
          live rate cards. Real weeks vary with the corpus and the number of revisions.
          {leadFallsBack && (
            <> The lead research loop uses Anthropic tool use and web search, so with this writer it runs on {LEAD_FALLBACK_MODEL}.</>
          )}
          {picked.missingRates.length > 0 && (
            <> No rate card for {picked.missingRates.join(', ')}: those legs are priced at zero here and their spend would not count against the weekly budget.</>
          )}
        </p>
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

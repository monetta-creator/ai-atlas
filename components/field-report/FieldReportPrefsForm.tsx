'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { saveFieldReportPrefsAction } from '@/lib/actions';
import type { FieldReportPrefs, Role } from '@/lib/field-report/store';
import { estimateUsd, MINUTES, type FieldReportSize, type Rate } from '@/lib/field-report/core';
import { SAVANT_MODEL_OPTIONS, TIER_LABEL, isAnthropicId, fmtUsd } from '@/lib/savant/cost-model';

const SIZES: FieldReportSize[] = ['brief', 'full'];
const ROLES: Role[] = ['research', 'writer', 'editor', 'figures'];
const ROLE_LABEL: Record<Role, string> = { research: 'Research', writer: 'Writer', editor: 'Editor', figures: 'Figures' };
const SIZE_LABEL: Record<FieldReportSize, string> = { brief: 'Brief', full: 'Full' };
const SIZE_NOTE: Record<FieldReportSize, string> = {
  brief: 'A few minutes, under a dollar.',
  full: 'Longer, with an editor review and figures.',
};
// Research, writer and editor run their own Anthropic tool loop with
// adaptive thinking, so those three pickers may only offer an Anthropic
// model id; figures goes through routedStructured and can pick anything.
const ANTHROPIC_ONLY_ROLES = new Set<Role>(['research', 'writer', 'editor']);
const WEB_SEARCH_MAX: Record<FieldReportSize, number> = { brief: 10, full: 25 };

function SavedTag({ status }: { status: { kind: 'ok' | 'error'; message: string } | null }) {
  if (!status) return null;
  return (
    <span className="frd-status" data-kind={status.kind}>
      {status.message}
    </span>
  );
}

// One model picker: the catalog grouped by tier, filtered to Anthropic ids
// for the three tool-loop roles; the saved id survives as a lone option even
// when it has dropped out of the catalog, so a value set by SQL never
// silently disappears on save.
function ModelSelect({
  id, value, rates, anthropicOnly, onChange,
}: { id: string; value: string; rates: Record<string, Rate>; anthropicOnly: boolean; onChange: (v: string) => void }) {
  const options = anthropicOnly ? SAVANT_MODEL_OPTIONS.filter((m) => isAnthropicId(m.id)) : SAVANT_MODEL_OPTIONS;
  const tiers = [...new Set(options.map((m) => m.tier))];
  const known = options.some((m) => m.id === value);
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value} (not in the catalog)</option>}
      {tiers.map((tier) => (
        <optgroup key={tier} label={TIER_LABEL[tier]}>
          {options.filter((m) => m.tier === tier).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}{m.tier !== 'anthropic' ? ` · ${m.vendor}` : ''}{rates[m.id] ? '' : ' (no rate card)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// The Field Report desk's settings card: on/off, a model picker per role for
// each size, effort, web searches, both daily caps, and a live per-size
// estimate. Calls saveFieldReportPrefsAction directly (not a native <form
// action>) because the action returns { ok, error } rather than throwing.
export default function FieldReportPrefsForm({ prefs, rates }: { prefs: FieldReportPrefs; rates: Record<string, Rate> }) {
  const [enabled, setEnabled] = useState(prefs.enabled);
  const [models, setModels] = useState(prefs.models);
  const [effort, setEffort] = useState(prefs.effort);
  const [webSearches, setWebSearches] = useState(prefs.webSearches);
  const [keyDailyUsd, setKeyDailyUsd] = useState(prefs.keyDailyUsd);
  const [allKeysDailyUsd, setAllKeysDailyUsd] = useState(prefs.allKeysDailyUsd);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const rateMap = useMemo(() => new Map(Object.entries(rates)), [rates]);
  const setModel = (size: FieldReportSize, role: Role, value: string) =>
    setModels((prev) => ({ ...prev, [size]: { ...prev[size], [role]: value } }));

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus(null);
    startTransition(async () => {
      const result = await saveFieldReportPrefsAction({ enabled, models, effort, webSearches, keyDailyUsd, allKeysDailyUsd });
      setStatus(result.ok ? { kind: 'ok', message: 'Saved.' } : { kind: 'error', message: result.error });
    });
  };

  return (
    <form className="sv-prefs frd-prefs" onSubmit={onSubmit}>
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          (pauses Field Report runs for admin and every keyholder)
        </span>
      </label>

      {SIZES.map((size) => {
        const est = estimateUsd(size, models[size], rateMap);
        const [minMin, maxMin] = MINUTES[size];
        return (
          <div key={size} className="frd-size-block">
            <h3 className="frd-size-h3">
              {SIZE_LABEL[size]} <span className="frd-size-note">{SIZE_NOTE[size]}</span>
            </h3>
            <div className="flex items-end gap-4" style={{ flexWrap: 'wrap' }}>
              {ROLES.map((role) => (
                <div className="field" key={role} style={{ minWidth: 200 }}>
                  <label htmlFor={`frd-${size}-${role}`}>{ROLE_LABEL[role]} model</label>
                  <ModelSelect
                    id={`frd-${size}-${role}`}
                    value={models[size][role]}
                    rates={rates}
                    anthropicOnly={ANTHROPIC_ONLY_ROLES.has(role)}
                    onChange={(v) => setModel(size, role, v)}
                  />
                </div>
              ))}
              <div className="field" style={{ minWidth: 130 }}>
                <label htmlFor={`frd-${size}-effort`}>Effort</label>
                <select
                  id={`frd-${size}-effort`}
                  className="input"
                  value={effort[size]}
                  onChange={(e) => setEffort((prev) => ({ ...prev, [size]: e.target.value as 'low' | 'medium' | 'high' }))}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="field" style={{ minWidth: 150 }}>
                <label htmlFor={`frd-${size}-web`}>Web searches (0 to {WEB_SEARCH_MAX[size]})</label>
                <input
                  id={`frd-${size}-web`}
                  type="number"
                  className="input"
                  min={0}
                  max={WEB_SEARCH_MAX[size]}
                  value={webSearches[size]}
                  onChange={(e) => setWebSearches((prev) => ({ ...prev, [size]: Number(e.target.value) }))}
                />
              </div>
            </div>
            <p className="frd-estimate">
              About {fmtUsd(est)} · about {minMin === maxMin ? `${minMin}` : `${minMin} to ${maxMin}`} min
            </p>
          </div>
        );
      })}

      <div className="flex items-end gap-4" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="frd-key-cap">Per-key daily cap (USD)</label>
          <input
            id="frd-key-cap"
            type="number"
            className="input"
            min={0}
            max={100}
            step="0.5"
            value={keyDailyUsd}
            onChange={(e) => setKeyDailyUsd(Number(e.target.value))}
          />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="frd-all-cap">All-keys daily cap (USD)</label>
          <input
            id="frd-all-cap"
            type="number"
            className="input"
            min={0}
            max={100}
            step="0.5"
            value={allKeysDailyUsd}
            onChange={(e) => setAllKeysDailyUsd(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="btn btn--primary btn--sm"
          disabled={pending}
          style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}
        >
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
        <SavedTag status={status} />
      </div>
    </form>
  );
}

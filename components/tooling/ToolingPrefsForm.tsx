'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveToolingPrefsAction } from '@/lib/actions';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import type { ToolingPrefs } from '@/lib/types';

// The tooling monitor's runtime switches, one form with one dirty-flag Save
// (mirrors the scout agent panel's steering + rubric save, folded together
// with the thresholds and model picks the mutation's saveToolingPrefs also
// clamps/validates server-side).
export default function ToolingPrefsForm({ prefs, defaultRubric }: { prefs: ToolingPrefs; defaultRubric: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(prefs.enabled);
  const [catalogThreshold, setCatalogThreshold] = useState(prefs.catalog_threshold);
  const [deepDiveThreshold, setDeepDiveThreshold] = useState(prefs.deep_dive_threshold);
  const [deepDiveCap, setDeepDiveCap] = useState(prefs.deep_dive_cap);
  const [autoPublish, setAutoPublish] = useState(prefs.auto_publish_entrants);
  const [utilityModel, setUtilityModel] = useState(prefs.utility_model ?? '');
  const [enrichModel, setEnrichModel] = useState(prefs.enrich_model ?? '');
  const [steering, setSteering] = useState(prefs.steering ?? '');
  const [rubric, setRubric] = useState(prefs.rubric ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    enabled !== prefs.enabled ||
    catalogThreshold !== prefs.catalog_threshold ||
    deepDiveThreshold !== prefs.deep_dive_threshold ||
    deepDiveCap !== prefs.deep_dive_cap ||
    autoPublish !== prefs.auto_publish_entrants ||
    utilityModel !== (prefs.utility_model ?? '') ||
    enrichModel !== (prefs.enrich_model ?? '') ||
    steering !== (prefs.steering ?? '') ||
    rubric !== (prefs.rubric ?? '');

  async function save() {
    setSaving(true);
    try {
      await saveToolingPrefsAction({
        enabled,
        catalog_threshold: catalogThreshold,
        deep_dive_threshold: deepDiveThreshold,
        deep_dive_cap: deepDiveCap,
        auto_publish_entrants: autoPublish,
        utility_model: utilityModel || null,
        enrich_model: enrichModel || null,
        steering: steering.trim() || null,
        rubric: rubric.trim() || null,
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          (pauses the Monday cron only; manual runs from above bypass this)
        </span>
      </label>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="field" style={{ width: 160 }}>
          <label htmlFor="tp-catalog">Catalog threshold (fit ≥)</label>
          <input id="tp-catalog" type="number" min={0} max={100} className="input"
            value={catalogThreshold} onChange={(e) => setCatalogThreshold(Number(e.target.value))} />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label htmlFor="tp-dd-threshold">Deep-dive threshold (fit ≥)</label>
          <input id="tp-dd-threshold" type="number" min={0} max={100} className="input"
            value={deepDiveThreshold} onChange={(e) => setDeepDiveThreshold(Number(e.target.value))} />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label htmlFor="tp-dd-cap">Deep-dive cap (per run)</label>
          <input id="tp-dd-cap" type="number" min={0} max={50} className="input"
            value={deepDiveCap} onChange={(e) => setDeepDiveCap(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)', paddingBottom: 8 }}>
          <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />
          Auto-publish the weekly new-entrants report
        </label>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="tp-utility">Utility model (triage, scoring)</label>
          <select id="tp-utility" className="input" value={utilityModel} onChange={(e) => setUtilityModel(e.target.value)}>
            <option value="">Default (qwen3.7-flash via OpenRouter, else Haiku)</option>
            {SCAN_ENRICH_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="tp-enrich">Enrichment model (homepage extraction)</label>
          <select id="tp-enrich" className="input" value={enrichModel} onChange={(e) => setEnrichModel(e.target.value)}>
            <option value="">Default (GLM-5.3 Flash via OpenRouter, else Haiku)</option>
            {SCAN_ENRICH_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="tp-steering">Steering note (the scoring agent reads this every run)</label>
        <textarea id="tp-steering" className="input" rows={2} maxLength={4000}
          placeholder="e.g. Contact-center AI and document intelligence are hot; deprioritize generic chatbots."
          value={steering} onChange={(e) => setSteering(e.target.value)} />
      </div>

      <details>
        <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
          The scoring rubric… {prefs.rubric ? '(customized)' : '(using the default)'}
        </summary>
        <div className="field" style={{ marginTop: 8 }}>
          <textarea id="tp-rubric" className="input" rows={10} maxLength={8000}
            placeholder={defaultRubric}
            value={rubric} onChange={(e) => setRubric(e.target.value)} />
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 4 }}>
            Empty means the built-in rubric applies. Edits take effect on the next scoring run.
          </p>
        </div>
      </details>

      {dirty && (
        <div>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      )}
    </div>
  );
}

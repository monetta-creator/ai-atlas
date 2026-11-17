'use client';

import { estimateTurnUsd, formatTurnCost, selectorModels } from '@/lib/llm/models';

const MODEL_OPTIONS = selectorModels();

// The answer-model picker (admin). One option list, two looks: the desktop
// composer foot shows the native select as a mono chip; the phone top bar
// (variant "pill") shows a short label in a pill with the native select laid
// invisibly over it, so a tap opens the platform's own picker.
export function modelLabel(id: string): string {
  if (id === 'auto') return 'Auto';
  return MODEL_OPTIONS.find((m) => m.id === id)?.label.replace(/^Claude /, '') ?? id;
}

export default function ModelSelect({
  model, onModel, disabled, variant = 'chip',
}: {
  model: string;
  onModel: (id: string) => void;
  disabled?: boolean;
  variant?: 'chip' | 'pill';
}) {
  const select = (
    <select
      className={variant === 'chip' ? 'ask-model-select' : undefined}
      value={model}
      onChange={(e) => onModel(e.target.value)}
      disabled={disabled}
      aria-label="Answer model"
      title="Auto lets the Atlas pick a model for each question; a manual pick uses the v2 chat"
    >
      <option value="auto">Auto</option>
      {(['claude', 'open-weight'] as const).map((fam) => (
        <optgroup key={fam} label={fam === 'claude' ? 'Claude' : 'Open-weight'}>
          {MODEL_OPTIONS.filter((m) => m.family === fam).map((m) => (
            <option key={m.id} value={m.id}>{m.label} · {formatTurnCost(estimateTurnUsd(m))}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
  if (variant === 'chip') return select;
  return (
    <span className="ask-model-pill" data-disabled={disabled ? '' : undefined}>
      <span className="ask-model-pill-label">{modelLabel(model)}</span>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
      {select}
    </span>
  );
}

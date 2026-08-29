'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setScanEnrichModelsAction } from '@/lib/actions';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';

// The enrichment model picker: which model(s) the scan's enrich leg uses.
// One selection = every item on that model; two or more = a deterministic
// round-robin split across them (the A/B test the Model A/B table reads);
// none = the Claude Haiku fallback. Saves the whole selection in one action.
export default function EnrichModelPicker({ selected }: { selected: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Set<string>>(new Set(selected));
  const dirty =
    choice.size !== selected.length || selected.some((id) => !choice.has(id));

  const toggle = (id: string) => {
    const next = new Set(choice);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChoice(next);
  };

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {SCAN_ENRICH_MODELS.map((m) => {
          const on = choice.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className="touch-chip"
              style={{
                fontSize: 11.5, padding: '4px 11px',
                color: on ? 'var(--supports)' : 'var(--faint-ink)',
                borderColor: on ? 'var(--supports)' : undefined,
              }}
              title={`${m.id} · ${m.vendor}`}
              onClick={() => toggle(m.id)}
            >
              {on ? '● ' : '○ '}{m.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
        <button
          className="btn"
          style={{ fontSize: 12, padding: '4px 14px', opacity: pending || !dirty ? 0.5 : 1 }}
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              await setScanEnrichModelsAction([...choice]);
              router.refresh();
            })
          }
        >
          {pending ? 'Saving…' : 'Save selection'}
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          {choice.size === 0
            ? 'None selected: enrichment falls back to Claude Haiku.'
            : choice.size === 1
            ? 'One model: every item uses it.'
            : `${choice.size} models: items split across them for the A/B comparison.`}
        </span>
      </div>
    </div>
  );
}

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setResearchModelsAction } from '@/lib/actions';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import EnrichModelPicker from '@/components/scan/EnrichModelPicker';

const DEFAULT_LABEL = 'default (Haiku)';

// The research console's model panel: two picks sharing the scan's cheap-model
// registry (lib/scan/models.ts SCAN_ENRICH_MODELS). Triage/agent take a
// single utility model (immediate-save chips, the TopicToggle/
// ScanEnabledToggle idiom: one click IS the save); analysis reuses the scan's
// own EnrichModelPicker unchanged (it already takes `selected` + a
// prop-injected `saveAction`) for the multi-select A/B pick.
function UtilityModelPicker({ selected }: { selected: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pick = (id: string | null) =>
    startTransition(async () => {
      await setResearchModelsAction({ triageModel: id });
      router.refresh();
    });
  return (
    <div className="flex items-center gap-2 flex-wrap" style={{ opacity: pending ? 0.5 : 1 }}>
      <button
        type="button"
        className="touch-chip"
        style={{
          fontSize: 11.5, padding: '4px 11px',
          color: selected === null ? 'var(--supports)' : 'var(--faint-ink)',
          borderColor: selected === null ? 'var(--supports)' : undefined,
        }}
        disabled={pending}
        onClick={() => pick(null)}
      >
        {selected === null ? '● ' : '○ '}{DEFAULT_LABEL}
      </button>
      {SCAN_ENRICH_MODELS.filter((m) => !m.anthropic).map((m) => {
        const on = selected === m.id;
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
            disabled={pending}
            onClick={() => pick(m.id)}
          >
            {on ? '● ' : '○ '}{m.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ResearchModelPicker({
  triageModel, analysisModels,
}: { triageModel: string | null; analysisModels: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
          Triage &amp; agent utility model · one click selects and saves
        </div>
        <UtilityModelPicker selected={triageModel} />
      </div>
      <div>
        <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
          Analysis models · picking two or more splits papers across them for the A/B table below
        </div>
        <EnrichModelPicker
          selected={analysisModels}
          saveAction={(models) => setResearchModelsAction({ analysisModels: models })}
          fallbackNote="None selected: analysis falls back to Claude Sonnet."
        />
      </div>
    </div>
  );
}

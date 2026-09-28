'use client';

import { useState } from 'react';
import type { FieldReportPlan, FieldReportPlanResponse, FieldReportSize } from '@/lib/field-report/core';
import { PLAN_LIMITS } from '@/lib/field-report/core';
import type { FieldReportState } from '@/components/ask/store';

const SIZE_LABEL: Record<FieldReportSize, string> = { brief: 'Brief', full: 'Full' };

function fmtUsd(usd: number): string {
  return usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

// A single editable list (sub-questions, considerations, Atlas focus, web
// gaps, out of scope): edit in place, remove, add up to `max`, and for
// sub-questions only, reorder. Kept local to this file since nothing else
// needs it.
function EditableList({
  label, items, onChange, max, reorder, placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  max: number;
  reorder?: boolean;
  placeholder: string;
}) {
  function setAt(i: number, value: string) {
    onChange(items.map((it, j) => (j === i ? value : it)));
  }
  function removeAt(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }
  function add() {
    if (items.length >= max) return;
    onChange([...items, '']);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="fr-plan-field">
      <label className="fr-plan-label">{label}</label>
      <div className="fr-plan-list">
        {items.map((it, i) => (
          <div key={i} className="fr-plan-list-row">
            {reorder && (
              <div className="fr-plan-reorder">
                <button type="button" className="fr-plan-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="fr-plan-icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
              </div>
            )}
            <input
              className="input fr-plan-input"
              value={it}
              placeholder={placeholder}
              onChange={(e) => setAt(i, e.target.value)}
              maxLength={PLAN_LIMITS.lineMax}
            />
            <button type="button" className="fr-plan-icon-btn" aria-label="Remove" onClick={() => removeAt(i)}>×</button>
          </div>
        ))}
      </div>
      {items.length < max && (
        <button type="button" className="btn btn--quiet btn--sm" onClick={add}>+ Add</button>
      )}
    </div>
  );
}

// The editable research plan (2026-09-28): every field can be changed before
// Run. Local state mirrors the passed-in plan; a regenerate (or an outright
// new plan from a fresh question) is delivered as a new `runId`, and the
// caller keys this component on `runId` so a regenerated plan resets every
// field cleanly instead of merging stale edits into new content.
export default function FieldReportPlanCard({
  runId, plan, estimates, capRoomUsd, question, context, onUpdate,
}: {
  runId: string;
  plan: FieldReportPlan;
  estimates?: FieldReportPlanResponse['estimates'];
  capRoomUsd?: number | null;
  question: string;
  context: string;
  onUpdate: (patch: Partial<FieldReportState>) => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const [objective, setObjective] = useState(plan.objective);
  const [subQuestions, setSubQuestions] = useState(plan.sub_questions);
  const [considerations, setConsiderations] = useState(plan.considerations);
  const [atlasFocus, setAtlasFocus] = useState(plan.atlas_focus);
  const [webGaps, setWebGaps] = useState(plan.web_gaps);
  const [outOfScope, setOutOfScope] = useState(plan.out_of_scope);
  const [size, setSize] = useState<FieldReportSize>(plan.recommended_size);
  const [note, setNote] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/field-report/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: context || undefined, previousRunId: runId, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => null)) as (FieldReportPlanResponse & { error?: string }) | null;
      if (!res.ok || !data?.plan) {
        setError((data && typeof data.error === 'string' && data.error) || 'Could not regenerate the plan. Please try again.');
        return;
      }
      onUpdate({ stage: 'plan', runId: data.runId, plan: data.plan, estimates: data.estimates, capRoomUsd: data.capRoomUsd ?? null });
    } catch {
      setError('Could not regenerate the plan. Please try again.');
    } finally {
      setRegenerating(false);
    }
  }

  async function runReport() {
    setError(null);
    const cleanObjective = objective.trim();
    const cleanSubs = subQuestions.map((s) => s.trim()).filter(Boolean);
    if (!cleanObjective) { setError('The plan needs an objective.'); return; }
    if (cleanSubs.length < PLAN_LIMITS.subMin) { setError(`The plan needs at least ${PLAN_LIMITS.subMin} sub-questions.`); return; }

    const editedPlan: FieldReportPlan = {
      title: title.trim() || cleanObjective.slice(0, PLAN_LIMITS.titleMax),
      objective: cleanObjective,
      sub_questions: cleanSubs,
      considerations: considerations.map((s) => s.trim()).filter(Boolean),
      atlas_focus: atlasFocus.map((s) => s.trim()).filter(Boolean),
      web_gaps: webGaps.map((s) => s.trim()).filter(Boolean),
      out_of_scope: outOfScope.map((s) => s.trim()).filter(Boolean),
      recommended_size: plan.recommended_size,
    };

    setRunning(true);
    try {
      const res = await fetch('/api/field-report/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, plan: editedPlan, size }),
      });
      const data = (await res.json().catch(() => null)) as { runId?: string; jobId?: string; error?: string } | null;
      if (!res.ok || !data?.jobId) {
        setError((data && typeof data.error === 'string' && data.error) || 'Could not start the run. Please try again.');
        return;
      }
      onUpdate({ stage: 'run', runId: data.runId ?? runId, plan: editedPlan, size, jobId: data.jobId });
    } catch {
      setError('Could not start the run. Please try again.');
    } finally {
      setRunning(false);
    }
  }

  const busy = regenerating || running;

  return (
    <div className="fr-card fr-plan">
      <p className="fr-kicker">FIELD REPORT · PLAN</p>

      <div className="fr-plan-field">
        <label className="fr-plan-label">Title</label>
        <input className="input" value={title} maxLength={PLAN_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="fr-plan-field">
        <label className="fr-plan-label">Objective</label>
        <textarea
          className="input fr-plan-textarea"
          rows={2}
          value={objective}
          maxLength={PLAN_LIMITS.objectiveMax}
          onChange={(e) => setObjective(e.target.value)}
        />
      </div>

      <EditableList
        label={`Sub-questions (${subQuestions.length}/${PLAN_LIMITS.subMax})`}
        items={subQuestions}
        onChange={setSubQuestions}
        max={PLAN_LIMITS.subMax}
        reorder
        placeholder="A sub-question this report will answer"
      />
      <EditableList
        label="Considerations you may not have asked about"
        items={considerations}
        onChange={setConsiderations}
        max={PLAN_LIMITS.listMax}
        placeholder="An angle worth checking"
      />
      <EditableList
        label="Atlas focus"
        items={atlasFocus}
        onChange={setAtlasFocus}
        max={PLAN_LIMITS.listMax}
        placeholder="A record, position, or thread it will check"
      />
      <EditableList
        label="Web gaps"
        items={webGaps}
        onChange={setWebGaps}
        max={PLAN_LIMITS.listMax}
        placeholder="What it will search for"
      />
      <EditableList
        label="Out of scope"
        items={outOfScope}
        onChange={setOutOfScope}
        max={PLAN_LIMITS.listMax}
        placeholder="What it will deliberately skip"
      />

      <div className="fr-plan-field">
        <label className="fr-plan-label">Size</label>
        <div className="fr-size-row">
          {(['brief', 'full'] as FieldReportSize[]).map((s) => {
            const est = estimates?.[s];
            return (
              <button
                key={s}
                type="button"
                className="fr-size-opt"
                aria-pressed={size === s}
                onClick={() => setSize(s)}
              >
                <span className="fr-size-name">{SIZE_LABEL[s]}</span>
                {est && (
                  <span className="fr-size-est">
                    {fmtUsd(est.usd)} · {est.minutes[0]}-{est.minutes[1]} min
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {typeof capRoomUsd === 'number' && (
          <p className="fr-cap-note">{fmtUsd(capRoomUsd)} of today&apos;s Field Report allowance left</p>
        )}
      </div>

      <div className="fr-plan-regen">
        <input
          className="input"
          placeholder="A note for the regenerated plan (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void regenerate()}>
          {regenerating ? 'Regenerating…' : 'Regenerate plan'}
        </button>
      </div>

      {error && <p className="fr-error">{error}</p>}

      <div className="fr-plan-run">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void runReport()}>
          {running ? 'Starting…' : `Run ${SIZE_LABEL[size]}`}
        </button>
      </div>
    </div>
  );
}

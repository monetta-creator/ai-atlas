'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { recommendConceptPrereqsAction, recommendConceptHypothesesAction } from '@/lib/actions';
import { CONCEPT_STATUS_LABEL } from '@/lib/format';
import type {
  ConceptStatus, ConceptPrereqRecommendation, ConceptHypothesisRecommendation,
} from '@/lib/types';
import type { TargetOption } from '@/lib/data';

const truncate = (s: string, n = 72) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

export interface ConceptOption {
  id: string;
  slug: string;
  name: string;
  short_definition: string;
}

interface InitialValues {
  name?: string;
  slug?: string;
  short_definition?: string;
  explanation?: string;
  status?: ConceptStatus;
  prerequisite_ids?: string[];
  codes?: string[];
}

function SubmitRow({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  const dim = pending ? { opacity: 0.6, cursor: 'wait' as const } : undefined;
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn btn--primary" disabled={pending} style={dim}>
        {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create concept'}
      </button>
    </div>
  );
}

// Create/edit a concept. Both AI buttons are recommend-only: suggestions come back
// to this form as data, the admin adds the ones they agree with to the selection,
// and nothing touches the database until the form itself is submitted.
export default function ConceptForm({
  action, mode, concepts, hypotheses, initial = {}, conceptId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode: 'create' | 'edit';
  concepts: ConceptOption[];      // prerequisite picker (self already excluded)
  hypotheses: TargetOption[];
  initial?: InitialValues;
  conceptId?: string;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [slug, setSlug] = useState(initial.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [shortDefinition, setShortDefinition] = useState(initial.short_definition ?? '');
  const [explanation, setExplanation] = useState(initial.explanation ?? '');
  const [status, setStatus] = useState<ConceptStatus>(initial.status ?? 'settled');
  const [prereqIds, setPrereqIds] = useState<Set<string>>(new Set(initial.prerequisite_ids ?? []));
  const [codes, setCodes] = useState<Set<string>>(new Set(initial.codes ?? []));

  const [prereqRecs, setPrereqRecs] = useState<ConceptPrereqRecommendation[] | null>(null);
  const [prereqBusy, setPrereqBusy] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [hypRecs, setHypRecs] = useState<ConceptHypothesisRecommendation[] | null>(null);
  const [hypBusy, setHypBusy] = useState(false);
  const [hypError, setHypError] = useState<string | null>(null);

  const canAsk = name.trim().length > 0 && shortDefinition.trim().length > 0;

  function toggleIn(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function suggestPrereqs() {
    setPrereqBusy(true);
    setPrereqError(null);
    try {
      const recs = await recommendConceptPrereqsAction({
        name, short_definition: shortDefinition, explanation, excludeId: conceptId,
      });
      setPrereqRecs(recs);
    } catch (e) {
      setPrereqError(e instanceof Error ? e.message : 'Could not get suggestions.');
    } finally {
      setPrereqBusy(false);
    }
  }

  async function suggestHypotheses() {
    setHypBusy(true);
    setHypError(null);
    try {
      const recs = await recommendConceptHypothesesAction({
        name, short_definition: shortDefinition, explanation,
      });
      setHypRecs(recs);
    } catch (e) {
      setHypError(e instanceof Error ? e.message : 'Could not get suggestions.');
    } finally {
      setHypBusy(false);
    }
  }

  return (
    <form
      action={action}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      {mode === 'edit' && conceptId && <input type="hidden" name="id" value={conceptId} />}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="prerequisite_ids" value={JSON.stringify([...prereqIds])} />
      <input type="hidden" name="codes" value={JSON.stringify([...codes])} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="concept_name">Name</label>
          <input
            id="concept_name"
            name="name"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Context window"
          />
        </div>
        <div className="field">
          <label htmlFor="concept_slug">Slug</label>
          <input
            id="concept_slug"
            name="slug"
            className="input"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="context-window"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="concept_short">Short definition: one sentence, shown on hover</label>
        <input
          id="concept_short"
          name="short_definition"
          className="input"
          value={shortDefinition}
          onChange={(e) => setShortDefinition(e.target.value)}
          placeholder="The maximum amount of text, measured in tokens, a model can take into account at once."
        />
      </div>

      <div className="field">
        <label htmlFor="concept_explanation">Explanation: the detail page&apos;s long form</label>
        <textarea
          id="concept_explanation"
          name="explanation"
          rows={6}
          className="input"
          style={{ resize: 'vertical' }}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="What it is, why it matters to the AI-economy debate, and where the term gets misused."
        />
      </div>

      {/* settled / contested — an intellectual judgment, so it gets more than a dropdown */}
      <div className="field">
        <label>Status</label>
        <div className="flex gap-2">
          {(['settled', 'contested'] as ConceptStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className="concept-status-btn"
              data-kind={s}
              data-on={status === s ? '' : undefined}
              onClick={() => setStatus(s)}
            >
              {CONCEPT_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: 0 }}>
          Settled: broad consensus on what the term means. Contested: the definition itself is disputed.
        </p>
      </div>

      {/* prerequisites */}
      <div className="field">
        <div className="flex items-center justify-between gap-3">
          <label style={{ margin: 0 }}>Prerequisites: understand these first</label>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={suggestPrereqs}
            disabled={prereqBusy || !canAsk}
            title={canAsk ? undefined : 'Add a name and short definition first'}
          >
            {prereqBusy ? 'Asking…' : '✦ AI suggest'}
          </button>
        </div>
        {prereqError && <p className="editable-error">{prereqError}</p>}
        {prereqRecs && (
          <div className="concept-recs">
            {prereqRecs.length === 0 ? (
              <p className="concept-rec-empty">No prerequisites recommended. This reads as foundational.</p>
            ) : (
              prereqRecs.map((r) => (
                <div key={r.id} className="concept-rec">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={prereqIds.has(r.id)}
                    onClick={() => setPrereqIds((prev) => new Set(prev).add(r.id))}
                  >
                    {prereqIds.has(r.id) ? '✓ Added' : '+ Add'}
                  </button>
                  <span className="concept-rec-name">{r.name}</span>
                  <span className="concept-rec-reason">{r.reason}</span>
                </div>
              ))
            )}
          </div>
        )}
        {concepts.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: 0 }}>
            No other concepts exist yet. This one will be foundational.
          </p>
        ) : (
          <div className="touch-picker">
            {concepts.map((c) => (
              <label key={c.id} className="touch-option">
                <input
                  type="checkbox"
                  checked={prereqIds.has(c.id)}
                  onChange={() => setPrereqIds((prev) => toggleIn(prev, c.id))}
                />
                <span className="touch-code">{c.slug}</span>
                <span className="touch-stmt">{c.name} · {truncate(c.short_definition, 56)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* hypothesis wiring */}
      <div className="field">
        <div className="flex items-center justify-between gap-3">
          <label style={{ margin: 0 }}>Hypotheses this concept is relevant to</label>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={suggestHypotheses}
            disabled={hypBusy || !canAsk}
            title={canAsk ? undefined : 'Add a name and short definition first'}
          >
            {hypBusy ? 'Asking…' : '✦ AI suggest'}
          </button>
        </div>
        {hypError && <p className="editable-error">{hypError}</p>}
        {hypRecs && (
          <div className="concept-recs">
            {hypRecs.length === 0 ? (
              <p className="concept-rec-empty">No hypotheses recommended. Nothing on the board leans on this concept.</p>
            ) : (
              hypRecs.map((r) => (
                <div key={r.code} className="concept-rec">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={codes.has(r.code)}
                    onClick={() => setCodes((prev) => new Set(prev).add(r.code))}
                  >
                    {codes.has(r.code) ? '✓ Added' : '+ Add'}
                  </button>
                  <span className="concept-rec-name">{r.code}</span>
                  <span className="concept-rec-reason">{r.reason}</span>
                </div>
              ))
            )}
          </div>
        )}
        <div className="touch-picker">
          {hypotheses.length > 0 && <div className="touch-group-label">Hypotheses</div>}
          {hypotheses.map((h) => (
            <label key={h.id} className="touch-option">
              <input
                type="checkbox"
                checked={codes.has(h.code)}
                onChange={() => setCodes((prev) => toggleIn(prev, h.code))}
              />
              <span className="touch-code">{h.code}</span>
              <span className="touch-stmt">{truncate(h.statement)}</span>
            </label>
          ))}
        </div>
      </div>

      <SubmitRow mode={mode} />
    </form>
  );
}

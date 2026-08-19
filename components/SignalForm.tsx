'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL, SIGNAL_LENS_COLOR, SIGNIFICANCE_LABEL,
} from '@/lib/format';
import type { Direction, Significance, SignalLens } from '@/lib/types';
import type { TargetOption } from '@/lib/data';

const truncate = (s: string, n = 72) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

type TouchDetail = { direction: Direction; reason: string };
const DIRECTION_OPTS: { value: Direction; label: string }[] = [
  { value: 'supports', label: 'Supports' },
  { value: 'contradicts', label: 'Contradicts' },
  { value: 'neutral', label: 'Neutral' },
];

interface InitialValues {
  title?: string;
  summary?: string;
  significance?: Significance;
  lenses?: SignalLens[];
  claim_touches?: string[];
  touch_details?: Record<string, TouchDetail>;
  source_id?: string | null;
  published_at?: string | null;
}

function SubmitRow({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  const dim = pending ? { opacity: 0.6, cursor: 'wait' as const } : undefined;
  if (mode === 'edit') {
    return (
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn--primary" disabled={pending} style={dim}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="submit" name="intent" value="draft" className="btn btn--ghost" disabled={pending} style={dim}>
        {pending ? 'Saving…' : 'Save as draft'}
      </button>
      <button type="submit" name="intent" value="publish" className="btn btn--primary" disabled={pending} style={dim}>
        {pending ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  );
}

export default function SignalForm({
  action, mode, claims, bridges, initial = {}, signalId, sources, lockedSourceId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  mode: 'create' | 'edit';
  claims: TargetOption[];
  bridges: TargetOption[];
  initial?: InitialValues;
  signalId?: string;
  sources?: { id: string; title: string | null }[];
  lockedSourceId?: string | null;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [summary, setSummary] = useState(initial.summary ?? '');
  const [significance, setSignificance] = useState<Significance>(initial.significance ?? 'medium');
  const [lenses, setLenses] = useState<Set<SignalLens>>(new Set(initial.lenses ?? []));
  const [touches, setTouches] = useState<Map<string, TouchDetail>>(
    () => new Map((initial.claim_touches ?? []).map((c) => [
      c, initial.touch_details?.[c] ?? { direction: 'neutral' as Direction, reason: '' },
    ]))
  );
  const [sourceId, setSourceId] = useState<string>(lockedSourceId ?? initial.source_id ?? '');
  const [publishedAt, setPublishedAt] = useState<string>(
    // published_at arrives from the DB as a Date (node-pg only overrides numeric), so
    // normalize to a YYYY-MM-DD string for <input type=date> instead of calling .slice.
    initial.published_at ? new Date(initial.published_at).toISOString().slice(0, 10) : ''
  );

  function toggleLens(l: SignalLens) {
    setLenses((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }
  function toggleTouch(code: string) {
    setTouches((prev) => {
      const next = new Map(prev);
      if (next.has(code)) next.delete(code);
      else next.set(code, { direction: 'neutral', reason: '' });
      return next;
    });
  }
  function setTouchField(code: string, patch: Partial<TouchDetail>) {
    setTouches((prev) => {
      const cur = prev.get(code);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(code, { ...cur, ...patch });
      return next;
    });
  }

  // One claim/bridge option: a checkbox, and — when checked — how this development
  // bears on it (the direction that becomes the materialized evidence's direction) plus
  // an optional reason (becomes the evidence excerpt).
  const renderOption = (opt: TargetOption) => {
    const detail = touches.get(opt.code);
    return (
      <div key={opt.id}>
        <label className="touch-option">
          <input type="checkbox" checked={!!detail} onChange={() => toggleTouch(opt.code)} />
          <span className="touch-code">{opt.code}</span>
          <span className="touch-stmt">{truncate(opt.statement)}</span>
        </label>
        {detail && (
          <div className="flex flex-wrap items-center gap-2" style={{ padding: '2px 0 8px 26px' }}>
            <select
              className="input"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={detail.direction}
              onChange={(e) => setTouchField(opt.code, { direction: e.target.value as Direction })}
              aria-label={`How this development bears on ${opt.code}`}
            >
              {DIRECTION_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="text"
              className="input"
              style={{ flex: 1, minWidth: 160, padding: '4px 8px', fontSize: 12 }}
              placeholder="Why (optional), becomes the evidence note"
              value={detail.reason}
              onChange={(e) => setTouchField(opt.code, { reason: e.target.value })}
              aria-label={`Reason for ${opt.code}`}
            />
          </div>
        )}
      </div>
    );
  };

  const lensesJson = JSON.stringify(SIGNAL_LENS_SLUGS.filter((s) => lenses.has(s)));
  const touchesJson = JSON.stringify([...touches.keys()]);
  const touchDetailsJson = JSON.stringify(Object.fromEntries(touches));

  return (
    <form
      action={action}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      {mode === 'edit' && signalId && <input type="hidden" name="id" value={signalId} />}
      <input type="hidden" name="lenses" value={lensesJson} />
      <input type="hidden" name="claim_touches" value={touchesJson} />
      <input type="hidden" name="touch_details" value={touchDetailsJson} />
      <input type="hidden" name="source_id" value={sourceId} />

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Hyperscaler capex commitments reach $725B for 2026"
        />
      </div>

      <div className="field">
        <label htmlFor="summary">Summary: 2–4 sentences, no jargon</label>
        <textarea
          id="summary"
          name="summary"
          rows={4}
          className="input"
          style={{ resize: 'vertical' }}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What happened, and why it matters to a financial institution."
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="significance">Significance</label>
          <select
            id="significance"
            name="significance"
            className="input"
            value={significance}
            onChange={(e) => setSignificance(e.target.value as Significance)}
          >
            {(['high', 'medium', 'low'] as Significance[]).map((s) => (
              <option key={s} value={s}>{SIGNIFICANCE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="published_at">Date</label>
          <input
            id="published_at"
            name="published_at"
            type="date"
            className="input"
            value={publishedAt}
            onChange={(e) => setPublishedAt(e.target.value)}
          />
        </div>
      </div>

      {/* lenses */}
      <div className="field">
        <label>Lenses</label>
        <div className="lens-chip-row">
          {SIGNAL_LENS_SLUGS.map((l) => {
            const on = lenses.has(l);
            return (
              <button
                key={l}
                type="button"
                className="lenschip"
                data-on={on ? '' : undefined}
                onClick={() => toggleLens(l)}
                style={
                  on
                    ? {
                        color: SIGNAL_LENS_COLOR[l],
                        borderColor: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 45%, var(--line))`,
                        background: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 10%, var(--surface))`,
                      }
                    : undefined
                }
              >
                {SIGNAL_LENS_LABEL[l]}
              </button>
            );
          })}
        </div>
      </div>

      {/* optional source picker (manual create / edit) */}
      {!lockedSourceId && sources && (
        <div className="field">
          <label htmlFor="source_select">Source (optional)</label>
          <select
            id="source_select"
            className="input"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">(none)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.title || 'Untitled source'}</option>
            ))}
          </select>
        </div>
      )}

      {/* claim_touches — each touched claim/bridge gets a direction (supports / contradicts /
          neutral) and an optional reason, which become the evidence materialized on publish. */}
      <div className="field">
        <label>Touches: claims &amp; bridge-claims this development bears on</label>
        <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: '0 0 6px' }}>
          For each, set whether the development supports or contradicts it. Evidence is written
          into the Argument Map when you publish.
        </p>
        <div className="touch-picker">
          {claims.length > 0 && <div className="touch-group-label">Claims</div>}
          {claims.map((c) => renderOption(c))}
          {bridges.length > 0 && <div className="touch-group-label">Bridge-claims</div>}
          {bridges.map((b) => renderOption(b))}
        </div>
      </div>

      <SubmitRow mode={mode} />
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { recommendBridgeFeedersAction } from '@/lib/actions';
import { DOMAIN_LABEL, RESOLVABILITY_LABEL } from '@/lib/format';
import type { Domain, Resolvability, Relation, BridgeFeederRecommendation } from '@/lib/types';
import type { TargetOption } from '@/lib/data';

const truncate = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const DOMAINS: Domain[] = ['capability', 'economics', 'build_out', 'market', 'labor'];
const RESOLVABILITIES: Resolvability[] = ['clean', 'slow', 'qualitative'];
const REL_OPTS: { value: Relation; label: string }[] = [
  { value: 'supports', label: 'supports' },
  { value: 'contradicts', label: 'contradicts' },
  { value: 'depends_on', label: 'depends on' },
];

const relSelectStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
};

export interface BridgeFeederInitial {
  code: string;
  relation: Relation;
}

interface InitialValues {
  code?: string;
  statement?: string;
  test?: string;
  domain_from?: Domain;
  domain_to?: Domain;
  resolvability?: Resolvability | null;
  note?: string;
  feeders?: BridgeFeederInitial[];
}

function SubmitRow() {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn btn--primary" disabled={pending} style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}>
        {pending ? 'Creating…' : 'Create bridge-claim'}
      </button>
    </div>
  );
}

// Author a new bridge-claim (an inter-domain object) and wire the claims that feed
// it. AI suggest is recommend-only; the form submit (createBridgeAction) is the
// sole writer.
export default function BridgeForm({
  action, claims, initial = {}, suggestedCode, thesisId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  claims: TargetOption[];
  initial?: InitialValues;
  suggestedCode: string;
  // Set when the draft came from a THESIS gap scan: the submit also maps the new
  // code onto that thesis (createBridgeAction reads the hidden field).
  thesisId?: string;
}) {
  const initialFeeders = new Map<string, Relation>();
  for (const f of initial.feeders ?? []) initialFeeders.set(f.code, f.relation);

  const [code, setCode] = useState(initial.code ?? suggestedCode);
  const [statement, setStatement] = useState(initial.statement ?? '');
  const [test, setTest] = useState(initial.test ?? '');
  const [domainFrom, setDomainFrom] = useState<Domain>(initial.domain_from ?? 'capability');
  const [domainTo, setDomainTo] = useState<Domain>(initial.domain_to ?? 'economics');
  const [resolvability, setResolvability] = useState<Resolvability | ''>(initial.resolvability ?? '');
  const [note, setNote] = useState(initial.note ?? '');
  const [feeders, setFeeders] = useState<Map<string, Relation>>(initialFeeders);

  const [recs, setRecs] = useState<BridgeFeederRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const canAsk = statement.trim().length > 0;

  function toggle(codeKey: string) {
    setFeeders((prev) => {
      const next = new Map(prev);
      if (next.has(codeKey)) next.delete(codeKey);
      else next.set(codeKey, 'supports');
      return next;
    });
  }
  function setRel(codeKey: string, rel: Relation) {
    setFeeders((prev) => new Map(prev).set(codeKey, rel));
  }

  async function suggest() {
    setBusy(true);
    setRecError(null);
    try {
      const r = await recommendBridgeFeedersAction({ statement, test });
      setRecs(r);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : 'Could not get suggestions.');
    } finally {
      setBusy(false);
    }
  }

  const feedersPayload = JSON.stringify([...feeders].map(([c, relation]) => ({ code: c, relation })));

  return (
    <form
      action={action}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <input type="hidden" name="resolvability" value={resolvability} />
      <input type="hidden" name="domain_from" value={domainFrom} />
      <input type="hidden" name="domain_to" value={domainTo} />
      <input type="hidden" name="feeders" value={feedersPayload} />
      {thesisId && <input type="hidden" name="thesis_id" value={thesisId} />}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="bridge_code">Code: this bridge&apos;s stable id</label>
          <input id="bridge_code" name="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="B5" />
        </div>
        <div className="field">
          <label>Domains it bridges</label>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={domainFrom} onChange={(e) => setDomainFrom(e.target.value as Domain)} className="input" style={{ width: 'auto' }}>
              {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
            </select>
            <span style={{ color: 'var(--faint-ink)' }}>→</span>
            <select value={domainTo} onChange={(e) => setDomainTo(e.target.value as Domain)} className="input" style={{ width: 'auto' }}>
              {DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="bridge_statement">Statement: the inter-domain claim</label>
        <textarea
          id="bridge_statement" name="statement" rows={2} className="input" style={{ resize: 'vertical' }}
          value={statement} onChange={(e) => setStatement(e.target.value)}
          placeholder="e.g. Capability gains translate into durable enterprise economics."
        />
      </div>

      <div className="field">
        <label htmlFor="bridge_test">Falsification test</label>
        <textarea
          id="bridge_test" name="test" rows={2} className="input" style={{ resize: 'vertical' }}
          value={test} onChange={(e) => setTest(e.target.value)}
          placeholder="What observation would show the bridge does not hold."
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label>Resolvability (optional)</label>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="concept-status-btn" data-on={resolvability === '' ? '' : undefined} onClick={() => setResolvability('')}>
              –
            </button>
            {RESOLVABILITIES.map((r) => (
              <button key={r} type="button" className="concept-status-btn" data-on={resolvability === r ? '' : undefined} onClick={() => setResolvability(r)}>
                {RESOLVABILITY_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="bridge_note">Note (optional)</label>
          <input id="bridge_note" name="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {/* feeder picker: which claims feed this bridge */}
      <div className="field">
        <div className="flex items-center justify-between gap-3">
          <label style={{ margin: 0 }}>Fed by: claims whose truth bears on this bridge</label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={suggest} disabled={busy || !canAsk} title={canAsk ? undefined : 'Write the statement first'}>
            {busy ? 'Asking…' : '✦ AI suggest'}
          </button>
        </div>
        {recError && <p className="editable-error">{recError}</p>}
        {recs && (
          <div className="concept-recs">
            {recs.length === 0 ? (
              <p className="concept-rec-empty">No feeders recommended. Pick the claims that feed it by hand.</p>
            ) : (
              recs.map((r) => {
                const added = feeders.has(r.code);
                return (
                  <div key={r.code} className="concept-rec">
                    <button type="button" className="btn btn--ghost btn--sm" disabled={added} onClick={() => setFeeders((prev) => new Map(prev).set(r.code, r.relation))}>
                      {added ? '✓ Added' : '+ Add'}
                    </button>
                    <span className="concept-rec-name">{r.code} · {r.relation === 'depends_on' ? 'depends on' : r.relation}</span>
                    <span className="concept-rec-reason">{r.reason}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
        <div className="touch-picker">
          {claims.map((c) => {
            const on = feeders.has(c.code);
            return (
              <div key={c.id} className="touch-option" onClick={() => toggle(c.code)} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                <span className="touch-code">{c.code}</span>
                <span className="touch-stmt">{truncate(c.statement)}</span>
                {on && (
                  <select
                    value={feeders.get(c.code)} style={relSelectStyle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRel(c.code, e.target.value as Relation)}
                  >
                    {REL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* live preview: a proposed-styled card (bridges aren't in the SVG graph) */}
      <div className="field">
        <label style={{ margin: 0 }}>Preview: the new bridge-claim and what feeds it</label>
        <div className="node" data-proposed="" style={{ marginTop: 8 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="cnum">⤧ {code.trim() || 'new'}</span>
            <span className="proposed-tag">proposed</span>
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--faint-ink)',
            }}
          >
            <span>{DOMAIN_LABEL[domainFrom]}</span>
            <span>→</span>
            <span>{DOMAIN_LABEL[domainTo]}</span>
          </div>
          <div className="ctxt" style={{ fontSize: 14, color: 'var(--ink)' }}>
            {statement.trim() || '(your bridge-claim)'}
          </div>
          {feeders.size > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>fed by</span>
              {[...feeders].map(([c, rel]) => (
                <span key={c} className={`relchip ${rel === 'contradicts' ? 'con' : 'sup'}`} style={{ display: 'inline-flex' }}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <SubmitRow />
    </form>
  );
}

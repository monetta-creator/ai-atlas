'use client';

import { useState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { recommendClaimEdgesAction } from '@/lib/actions';
import { DOMAIN_LABEL, RESOLVABILITY_LABEL } from '@/lib/format';
import type { Domain, Resolvability, Relation, ClaimEdgeRecommendation, Stance, Claim, Edge } from '@/lib/types';
import type { TargetOption } from '@/lib/data';
import QuestionMap, { type ProposedClaim } from './QuestionMap';

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

export interface ClaimEdgeInitial {
  target_type: 'stance' | 'bridge_claim';
  code: string;
  relation: Relation;
}

interface InitialValues {
  code?: string;
  statement?: string;
  test?: string;
  domain?: Domain;
  resolvability?: Resolvability | null;
  domain_note?: string;
  edges?: ClaimEdgeInitial[];
}

function SubmitRow() {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn btn--primary" disabled={pending} style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}>
        {pending ? 'Creating…' : 'Create claim'}
      </button>
    </div>
  );
}

// Author a new claim and wire its edges. The AI suggest button is recommend-only:
// suggestions come back as data, the admin adds the ones they agree with, and
// nothing touches the database until the form is submitted (createClaimAction).
export default function ClaimForm({
  action, questionSlug, questionLabel, stances, claims, edges, bridges, initial = {}, suggestedCode, thesisId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  questionSlug: string;
  questionLabel: string;
  stances: Stance[];        // full stances of the host question (picker + preview)
  claims: Claim[];          // the question's existing claims (preview context)
  edges: Edge[];            // the question's existing edges (preview context)
  bridges: TargetOption[];
  initial?: InitialValues;
  suggestedCode: string;
  // Set when the draft came from a THESIS gap scan: the submit also maps the new
  // code onto that thesis (createClaimAction reads the hidden field).
  thesisId?: string;
}) {
  const initialStance = new Map<string, Relation>();
  const initialBridge = new Map<string, Relation>();
  for (const e of initial.edges ?? []) {
    if (e.target_type === 'stance') initialStance.set(e.code, e.relation);
    else initialBridge.set(e.code, e.relation);
  }

  const [code, setCode] = useState(initial.code ?? suggestedCode);
  const [statement, setStatement] = useState(initial.statement ?? '');
  const [test, setTest] = useState(initial.test ?? '');
  const [domain, setDomain] = useState<Domain>(initial.domain ?? 'capability');
  const [resolvability, setResolvability] = useState<Resolvability | ''>(initial.resolvability ?? '');
  const [domainNote, setDomainNote] = useState(initial.domain_note ?? '');
  const [stanceEdges, setStanceEdges] = useState<Map<string, Relation>>(initialStance);
  const [bridgeEdges, setBridgeEdges] = useState<Map<string, Relation>>(initialBridge);

  const [recs, setRecs] = useState<ClaimEdgeRecommendation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const canAsk = statement.trim().length > 0;

  function toggle(map: Map<string, Relation>, set: (m: Map<string, Relation>) => void, codeKey: string) {
    const next = new Map(map);
    if (next.has(codeKey)) next.delete(codeKey);
    else next.set(codeKey, 'supports');
    set(next);
  }
  function setRel(map: Map<string, Relation>, set: (m: Map<string, Relation>) => void, codeKey: string, rel: Relation) {
    const next = new Map(map);
    next.set(codeKey, rel);
    set(next);
  }

  async function suggest() {
    setBusy(true);
    setRecError(null);
    try {
      const r = await recommendClaimEdgesAction({ statement, test, questionSlug });
      setRecs(r);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : 'Could not get suggestions.');
    } finally {
      setBusy(false);
    }
  }

  function addRec(r: ClaimEdgeRecommendation) {
    if (r.target_type === 'stance') setStanceEdges((prev) => new Map(prev).set(r.code, r.relation));
    else setBridgeEdges((prev) => new Map(prev).set(r.code, r.relation));
  }

  const edgesPayload = JSON.stringify([
    ...[...stanceEdges].map(([c, relation]) => ({ target_type: 'stance', code: c, relation })),
    ...[...bridgeEdges].map(([c, relation]) => ({ target_type: 'bridge_claim', code: c, relation })),
  ]);

  // The live ghost: rebuilt each render from form state so the map updates as you type
  // and pick. Resolve stance codes -> ids for the SVG overlay (bridges aren't graphed).
  const stanceIdByCode = useMemo(() => new Map(stances.map((s) => [s.code, s.id])), [stances]);
  const hasGhost = statement.trim().length > 0 || stanceEdges.size > 0;
  const proposed: ProposedClaim | null = hasGhost
    ? {
        id: '__proposed__',
        code: code.trim(),
        statement: statement.trim(),
        stanceEdges: [...stanceEdges].flatMap(([c, relation]) => {
          const id = stanceIdByCode.get(c);
          return id ? [{ stanceId: id, relation }] : [];
        }),
      }
    : null;

  return (
    <form
      action={action}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="resolvability" value={resolvability} />
      <input type="hidden" name="edges" value={edgesPayload} />
      {thesisId && <input type="hidden" name="thesis_id" value={thesisId} />}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="claim_code">Code: this claim&apos;s stable id, referenced everywhere</label>
          <input id="claim_code" name="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="3.6" />
        </div>
        <div className="field">
          <label>Domain: the single firewall domain</label>
          <div className="flex gap-2 flex-wrap">
            {DOMAINS.map((d) => (
              <button key={d} type="button" className="concept-status-btn" data-on={domain === d ? '' : undefined} onClick={() => setDomain(d)}>
                {DOMAIN_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="claim_statement">Statement: the claim, as a falsifiable assertion</label>
        <textarea
          id="claim_statement" name="statement" rows={2} className="input" style={{ resize: 'vertical' }}
          value={statement} onChange={(e) => setStatement(e.target.value)}
          placeholder="e.g. Enterprises achieve measurable ROI and renew / expand, not just pilot."
        />
      </div>

      <div className="field">
        <label htmlFor="claim_test">Falsification test: what would show this claim is wrong</label>
        <textarea
          id="claim_test" name="test" rows={2} className="input" style={{ resize: 'vertical' }}
          value={test} onChange={(e) => setTest(e.target.value)}
          placeholder="e.g. Net revenue retention + pilot-to-production stay low across the base."
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label>Resolvability: how cleanly this can settle (optional)</label>
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
          <label htmlFor="claim_note">Domain note: a free annotation (optional)</label>
          <input id="claim_note" name="domain_note" className="input" value={domainNote} onChange={(e) => setDomainNote(e.target.value)} placeholder="e.g. Economics + Capability" />
        </div>
      </div>

      {/* edge picker: which stances this claim bears on (required), which bridges it feeds */}
      <div className="field">
        <div className="flex items-center justify-between gap-3">
          <label style={{ margin: 0 }}>Bears on: stances in {questionLabel} (pick at least one) and bridge-claims it feeds</label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={suggest} disabled={busy || !canAsk} title={canAsk ? undefined : 'Write the statement first'}>
            {busy ? 'Asking…' : '✦ AI suggest'}
          </button>
        </div>
        {recError && <p className="editable-error">{recError}</p>}
        {recs && (
          <div className="concept-recs">
            {recs.length === 0 ? (
              <p className="concept-rec-empty">No edges recommended. Pick the stances it bears on by hand.</p>
            ) : (
              recs.map((r) => {
                const added = r.target_type === 'stance' ? stanceEdges.has(r.code) : bridgeEdges.has(r.code);
                return (
                  <div key={`${r.target_type}:${r.code}`} className="concept-rec">
                    <button type="button" className="btn btn--ghost btn--sm" disabled={added} onClick={() => addRec(r)}>
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
          {stances.length > 0 && <div className="touch-group-label">Stances</div>}
          {stances.map((s) => {
            const on = stanceEdges.has(s.code);
            return (
              <div key={s.id} className="touch-option" onClick={() => toggle(stanceEdges, setStanceEdges, s.code)} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                <span className="touch-code">{s.code}</span>
                <span className="touch-stmt">{truncate(s.title, 60)}</span>
                {on && (
                  <select
                    value={stanceEdges.get(s.code)} style={relSelectStyle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRel(stanceEdges, setStanceEdges, s.code, e.target.value as Relation)}
                  >
                    {REL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          {bridges.length > 0 && <div className="touch-group-label">Bridge-claims (feeds)</div>}
          {bridges.map((b) => {
            const on = bridgeEdges.has(b.code);
            return (
              <div key={b.id} className="touch-option" onClick={() => toggle(bridgeEdges, setBridgeEdges, b.code)} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                <span className="touch-code">{b.code}</span>
                <span className="touch-stmt">{truncate(b.statement)}</span>
                {on && (
                  <select
                    value={bridgeEdges.get(b.code)} style={relSelectStyle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRel(bridgeEdges, setBridgeEdges, b.code, e.target.value as Relation)}
                  >
                    {REL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* live preview: the proposed claim as a dashed ghost on the real question map */}
      <div className="field">
        <label style={{ margin: 0 }}>Preview: where this claim lands on the {questionLabel} map</label>
        <div className="map-legend" style={{ marginTop: 10 }}>
          <span className="k sup"><span className="line" /> supports</span>
          <span className="k con"><span className="line" /> contradicts</span>
          <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            dashed = your proposed claim
          </span>
        </div>
        <QuestionMap stances={stances} claims={claims} edges={edges} admin proposed={proposed} />
      </div>

      <SubmitRow />
    </form>
  );
}

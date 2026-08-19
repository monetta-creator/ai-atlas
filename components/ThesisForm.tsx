'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mapThesisAction, createThesisAction, updateThesisAction } from '@/lib/actions';
import type { ThesisMappingProposal } from '@/lib/thesis/map';
import type { TargetOption } from '@/lib/data';

// Create/edit a standing thesis. The AI mapping is recommend-only: "Map to Atlas
// claims" proposes codes with a one-line why each; the admin checks/unchecks and can
// add any claim manually; only the confirmed set is written (and the writer refuses
// a dangling code). An empty mapping is a legitimate save: the report runs text-only
// and says so.

export default function ThesisForm({
  targets,
  thesis,
}: {
  targets: { claims: TargetOption[]; bridges: TargetOption[] };
  thesis?: { id: string; statement: string; claim_codes: string[]; mapping_note: string | null };
}) {
  const router = useRouter();
  const all = [...targets.claims, ...targets.bridges];
  const statementByCode = new Map(all.map((t) => [t.code, t.statement]));

  const [statement, setStatement] = useState(thesis?.statement ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(thesis?.claim_codes ?? []));
  const [proposals, setProposals] = useState<ThesisMappingProposal[]>([]);
  const [note, setNote] = useState(thesis?.mapping_note ?? '');
  const [mapping, setMapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  async function runMapping() {
    if (!statement.trim() || mapping) return;
    setMapping(true);
    setError('');
    try {
      const r = await mapThesisAction(statement);
      if (!r.ok) {
        setError(r.error);
      } else {
        setProposals(r.proposals);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const p of r.proposals) next.add(p.code);
          return next;
        });
        if (r.note) setNote(r.note);
        if (!r.proposals.length) setError('No claim in the Atlas maps to this thesis yet. You can still save it: the report will run on text matches and say so.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mapping failed');
    } finally {
      setMapping(false);
    }
  }

  async function save() {
    if (!statement.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const input = { statement, claimCodes: [...selected], mappingNote: note || null };
      if (thesis) {
        await updateThesisAction(thesis.id, input);
        router.refresh();
      } else {
        const { id } = await createThesisAction(input);
        router.push(`/theses/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
      setSaving(false);
    }
  }

  const chosen = [...selected].sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="field">
        <label htmlFor="thesis-statement">Thesis</label>
        <textarea
          id="thesis-statement"
          className="input"
          rows={3}
          maxLength={500}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="State the hypothesis in one or two plain sentences, e.g. AI is reducing entry-level knowledge-work hiring."
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="btn" onClick={runMapping} disabled={!statement.trim() || mapping}>
          {mapping ? 'Mapping…' : '✦ Map to Atlas claims'}
        </button>
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Recommend-only: you confirm every code before it is saved.
        </span>
      </div>

      {proposals.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="flex flex-col gap-2">
          {proposals.map((p) => (
            <li key={p.code} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(p.code)} onChange={() => toggle(p.code)} />
                <span style={{ fontSize: 13 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{p.code}</span>
                  {' · '}
                  <span style={{ color: 'var(--ink)' }}>{p.statement}</span>
                  <br />
                  <span style={{ color: 'var(--faint-ink)' }}>{p.why}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="field">
        <label htmlFor="thesis-manual">Add a claim manually</label>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            id="thesis-manual"
            className="input"
            style={{ maxWidth: 520 }}
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
          >
            <option value="">Pick a claim or bridge-claim…</option>
            {all.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} · {t.statement.slice(0, 90)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!manualCode}
            onClick={() => {
              if (manualCode) toggle(manualCode);
              setManualCode('');
            }}
          >
            Add
          </button>
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ fontSize: 12 }}>
          {chosen.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              title={statementByCode.get(code) ?? code}
              style={{
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--line)',
                borderRadius: 999,
                padding: '2px 10px',
                background: 'var(--surface)',
                color: 'var(--accent)',
                cursor: 'pointer',
              }}
            >
              {code} ✕
            </button>
          ))}
        </div>
      )}

      <div className="field">
        <label htmlFor="thesis-note">Mapping note (optional)</label>
        <textarea
          id="thesis-note"
          className="input"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Context on the mapping, or what the Atlas lacks for this thesis."
        />
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--heat-4)' }}>{error}</p>}

      <div>
        <button type="button" className="btn btn--primary" onClick={save} disabled={!statement.trim() || saving}>
          {saving ? 'Saving…' : thesis ? 'Save changes' : 'Create thesis'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  buildSheetPackAction, generateSheetSectionsAction, generateSheetCloseAction, saveSheetAction,
} from '@/lib/actions';
import type { SheetSectionsOut } from '@/lib/tearsheet/generate';
import type { SheetPack } from '@/lib/types';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL } from '@/lib/format';
import { useModelRun } from '@/lib/jobs/use-model-run';
import type { FeatureStats, StepSpec, UiJob } from '@/lib/jobs/core';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// The Report Portal's generator console (admin): pick a pre-ready report kind
// (the AlphaSense-agents card grid), a subject, and a scope; ONE button chains
// pack -> sections -> close -> save, each leg its own <=60s server action with
// client retries (the ThesisConsole discipline). Completion AUTO-SAVES a DRAFT:
// saving a draft is not publication, the publish toggle on the drafts list is
// the human gate that makes a report and its PDF public.

type Kind = 'claim' | 'lens' | 'atlas';

const CARDS: { kind: Kind | 'period' | 'thesis'; name: string; desc: string; href?: string; cta?: string }[] = [
  { kind: 'claim', name: 'Claim tear sheet', desc: 'One claim or bridge-claim: the evidence, the signals, the connections, and what would move it.' },
  { kind: 'lens', name: 'Lens deep report', desc: 'One audience lens: its signals, the claims they touch, and the cross-claim read.' },
  { kind: 'atlas', name: 'Executive briefing', desc: 'The whole Atlas: where the debate stands, what moved, and what to watch.' },
  { kind: 'period', name: 'Period report', desc: 'A date range across every lens: the narrative, the callouts, and the claims recap, hand-edited before saving.', href: '/reports/period', cta: 'Open the period console' },
  { kind: 'thesis', name: 'Thesis report', desc: 'A standing thesis re-run against the corpus. Generated from the Theses console.', href: '/theses', cta: 'Open the theses console' },
];

// The chain, declared once: the panel's stepper, its running sentences, and
// the ai_cost_log features whose history gives the usual time and cost.
const STEPS: StepSpec[] = [
  { key: 'pack', label: 'Evidence pack', running: 'Gathering the evidence, signals and connections from the Atlas…' },
  { key: 'sections', label: 'Cited narrative', running: 'Writing the cited narrative (the longest step)…', features: ['tearsheet_sections'] },
  { key: 'close', label: 'Bottom line', running: 'Writing the bottom line and the title…', features: ['tearsheet_close'] },
  { key: 'save', label: 'Saved as a draft', running: 'Saving the draft…' },
];

export interface SheetTargetOption { code: string; statement: string }

export default function SheetConsole({
  claims, bridges, initialKind, initialCode, stats, initialJob,
}: {
  claims: SheetTargetOption[];
  bridges: SheetTargetOption[];
  initialKind?: Kind;
  initialCode?: string;
  stats?: FeatureStats | null;
  initialJob?: UiJob | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind ?? 'claim');
  const [code, setCode] = useState(initialCode ?? '');
  const [lens, setLens] = useState<string>(SIGNAL_LENS_SLUGS[0]);
  const [scopeMode, setScopeMode] = useState<'all' | 'window'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [saved, setSaved] = useState<{ id: string; title: string; dropped: string[] } | null>(null);
  // What a resumed run may reuse: the pack and sections built for these same
  // inputs (a retry from the narrative never rebuilds the pack).
  const [cache, setCache] = useState<{ key: string; pack?: SheetPack; sections?: SheetSectionsOut } | null>(null);

  const subject = kind === 'claim' ? code : kind === 'lens' ? lens : null;
  const scope = scopeMode === 'window' ? { from: from || null, to: to || null } : { from: null, to: null };
  const runKey = JSON.stringify([kind, subject, scope]);
  const kindName = kind === 'claim' ? 'Claim tear sheet' : kind === 'lens' ? 'Lens report' : 'Executive briefing';

  const run = useModelRun({
    kind: 'sheet',
    subject: `${kind}:${subject ?? 'atlas'}`,
    label: `${kindName}${subject ? `, ${kind === 'lens' ? SIGNAL_LENS_LABEL[subject as keyof typeof SIGNAL_LENS_LABEL] ?? subject : subject}` : ''}`,
    steps: STEPS,
    stats,
    initialJob,
    run: async (ctx, resumeFrom) => {
      setSaved(null);
      const reuse = resumeFrom && cache?.key === runKey ? cache : null;
      let pack = resumeFrom === 'pack' ? undefined : reuse?.pack;
      if (!pack) {
        const r = await ctx.step('pack', () => buildSheetPackAction(kind, subject, scope));
        if (!r.ok) throw new Error(r.error);
        pack = r.pack;
        const p = pack;
        setCache({ key: runKey, pack: p });
        ctx.note(`✓ Evidence pack built`);
      }
      let sections = resumeFrom === 'close' || resumeFrom === 'save' ? reuse?.sections : undefined;
      if (!sections) {
        const p = pack;
        const r = await ctx.step('sections', () => generateSheetSectionsAction(p));
        if (!r.ok) throw new Error(r.error);
        sections = r.sections;
        const s = sections;
        setCache({ key: runKey, pack: p, sections: s });
        ctx.note('✓ Narrative written');
      }
      const p = pack; const s = sections;
      const closeRes = await ctx.step('close', () => generateSheetCloseAction(p, {
        readingMd: s.readingMd, connectionsMd: s.connectionsMd, watchMd: s.watchMd,
      }));
      if (!closeRes.ok) throw new Error(closeRes.error);
      const { id } = await ctx.step('save', () => saveSheetAction({
        title: closeRes.title,
        pack: p,
        narrative: {
          reading: s.readingHtml || null,
          connections: s.connectionsHtml || null,
          watch: s.watchHtml || null,
          bottomLine: closeRes.bottomLineHtml || null,
        },
      }));
      setSaved({ id, title: closeRes.title, dropped: [...new Set([...s.dropped, ...closeRes.dropped])] });
      router.refresh();
      return { href: `/reports/sheet/${id}`, note: `✓ Saved as a draft: ${closeRes.title}` };
    },
  });

  const busy = run.status === 'running';
  const canRun = !busy && (kind !== 'claim' || !!code);

  return (
    <div>
      <div className="lobby-grid" style={{ marginBottom: 'var(--gap)' }}>
        {CARDS.map((c) =>
          c.href ? (
            <Link key={c.kind} href={c.href} className="lobby-tile" style={{ minHeight: 0 }}>
              <span className="lobby-tile-name">{c.name}</span>
              <span className="lobby-tile-desc">{c.desc}</span>
              <span className="lobby-tile-stat">{c.cta}</span>
            </Link>
          ) : (
            <button
              key={c.kind}
              type="button"
              className="lobby-tile"
              style={{
                minHeight: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit',
                borderColor: kind === c.kind ? 'var(--accent)' : undefined,
              }}
              aria-pressed={kind === c.kind}
              onClick={() => { setKind(c.kind as Kind); setSaved(null); }}
            >
              <span className="lobby-tile-name">{c.name}</span>
              <span className="lobby-tile-desc">{c.desc}</span>
              <span className="lobby-tile-stat" style={kind === c.kind ? { color: 'var(--accent)' } : undefined}>
                {kind === c.kind ? 'Selected' : 'Select'}
              </span>
            </button>
          )
        )}
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        {kind === 'claim' && (
          <div className="field" style={{ minWidth: 320, flex: 1 }}>
            <label htmlFor="sheet-code">Claim or bridge-claim</label>
            <select id="sheet-code" className="input" value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">Pick a claim…</option>
              <optgroup label="Claims">
                {claims.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.statement.slice(0, 90)}</option>
                ))}
              </optgroup>
              <optgroup label="Bridge-claims">
                {bridges.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} · {c.statement.slice(0, 90)}</option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
        {kind === 'lens' && (
          <div className="field" style={{ minWidth: 240 }}>
            <label htmlFor="sheet-lens">Lens</label>
            <select id="sheet-lens" className="input" value={lens} onChange={(e) => setLens(e.target.value)}>
              {SIGNAL_LENS_SLUGS.map((l) => (
                <option key={l} value={l}>{SIGNAL_LENS_LABEL[l]}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field" style={{ minWidth: 150 }}>
          <label htmlFor="sheet-scope">Scope</label>
          <select id="sheet-scope" className="input" value={scopeMode}
            onChange={(e) => setScopeMode(e.target.value as 'all' | 'window')}>
            <option value="all">Everything in the Atlas</option>
            <option value="window">Time window</option>
          </select>
        </div>
        {scopeMode === 'window' && (
          <>
            <div className="field">
              <label htmlFor="sheet-from">From</label>
              <input id="sheet-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sheet-to">To</label>
              <input id="sheet-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <button type="button" className="btn btn--primary" disabled={!canRun} onClick={() => void run.start()}>
          {busy ? <><span className="spinner mr-btn-spin" aria-hidden="true" />Generating</> : 'Generate report'}
        </button>
      </div>

      <ModelRunPanel run={run} doneLabel="Open the draft">
        {saved && (
          <p className="text-sm" style={{ color: 'var(--dim)', margin: 0 }}>
            Review it, then publish it from the drafts list below.
            {saved.dropped.length > 0 && (
              <> The citation gate stripped {saved.dropped.length} link{saved.dropped.length === 1 ? '' : 's'} the pack could not vouch for.</>
            )}
          </p>
        )}
      </ModelRunPanel>
    </div>
  );
}

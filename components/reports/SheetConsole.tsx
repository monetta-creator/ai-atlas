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

// The Report Portal's generator console (admin): pick a pre-ready report kind
// (the AlphaSense-agents card grid), a subject, and a scope; ONE button chains
// pack -> sections -> close -> save, each leg its own <=60s server action with
// client retries (the ThesisConsole discipline). Completion AUTO-SAVES a DRAFT:
// saving a draft is not publication, the publish toggle on the drafts list is
// the human gate that makes a report and its PDF public.

const MAX_ATTEMPTS = 3;
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, attempt * 1500));

async function withRetry<T extends { ok: boolean }>(fn: () => Promise<T>): Promise<T> {
  let last: T | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      last = await fn();
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : 'error' } as unknown as T;
    }
    if (attempt < MAX_ATTEMPTS) await backoff(attempt);
  }
  return last as T;
}

type Kind = 'claim' | 'lens' | 'atlas';

const CARDS: { kind: Kind | 'period' | 'thesis'; name: string; desc: string; href?: string; cta?: string }[] = [
  { kind: 'claim', name: 'Claim tear sheet', desc: 'One claim or bridge-claim: the evidence, the signals, the connections, and what would move it.' },
  { kind: 'lens', name: 'Lens deep report', desc: 'One audience lens: its signals, the claims they touch, and the cross-claim read.' },
  { kind: 'atlas', name: 'Executive briefing', desc: 'The whole Atlas: where the debate stands, what moved, and what to watch.' },
  { kind: 'period', name: 'Period report', desc: 'A date range across every lens: the narrative, the callouts, and the claims recap, hand-edited before saving.', href: '/reports/period', cta: 'Open the period console' },
  { kind: 'thesis', name: 'Thesis report', desc: 'A standing thesis re-run against the corpus. Generated from the Theses console.', href: '/theses', cta: 'Open the theses console' },
];

const STEPS = [
  { key: 'pack', running: 'Building the evidence pack…' },
  { key: 'sections', running: 'Writing the cited narrative…' },
  { key: 'close', running: 'Writing the bottom line…' },
  { key: 'save', running: 'Saving the draft…' },
] as const;

export interface SheetTargetOption { code: string; statement: string }

export default function SheetConsole({
  claims, bridges, initialKind, initialCode,
}: {
  claims: SheetTargetOption[];
  bridges: SheetTargetOption[];
  initialKind?: Kind;
  initialCode?: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind ?? 'claim');
  const [code, setCode] = useState(initialCode ?? '');
  const [lens, setLens] = useState<string>(SIGNAL_LENS_SLUGS[0]);
  const [scopeMode, setScopeMode] = useState<'all' | 'window'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; dropped: string[] } | null>(null);

  const subject = kind === 'claim' ? code : kind === 'lens' ? lens : null;
  const canRun = !running && (kind !== 'claim' || !!code);

  async function generate() {
    if (!canRun) return;
    setError(null);
    setSaved(null);
    const scope = scopeMode === 'window' ? { from: from || null, to: to || null } : { from: null, to: null };
    try {
      setRunning(STEPS[0].running);
      const packRes = await withRetry(() => buildSheetPackAction(kind, subject, scope));
      if (!packRes.ok) throw new Error(packRes.error);
      const pack: SheetPack = packRes.pack;

      setRunning(STEPS[1].running);
      const secRes = await withRetry(() => generateSheetSectionsAction(pack));
      if (!secRes.ok) throw new Error(secRes.error);
      const sections: SheetSectionsOut = secRes.sections;

      setRunning(STEPS[2].running);
      const closeRes = await withRetry(() => generateSheetCloseAction(pack, {
        readingMd: sections.readingMd, connectionsMd: sections.connectionsMd, watchMd: sections.watchMd,
      }));
      if (!closeRes.ok) throw new Error(closeRes.error);

      setRunning(STEPS[3].running);
      const { id } = await saveSheetAction({
        title: closeRes.title,
        pack,
        narrative: {
          reading: sections.readingHtml || null,
          connections: sections.connectionsHtml || null,
          watch: sections.watchHtml || null,
          bottomLine: closeRes.bottomLineHtml || null,
        },
      });
      setSaved({
        id,
        title: closeRes.title,
        dropped: [...new Set([...sections.dropped, ...closeRes.dropped])],
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setRunning(null);
    }
  }

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
              onClick={() => { setKind(c.kind as Kind); setSaved(null); setError(null); }}
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
        <button type="button" className="btn btn--primary" disabled={!canRun} onClick={() => void generate()}>
          {running ? 'Generating…' : 'Generate report'}
        </button>
      </div>

      {running && (
        <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 10 }}>
          <span className="spinner" style={{ marginRight: 8, verticalAlign: -2 }} />{running}
        </p>
      )}
      {error && (
        <p className="text-sm" style={{ color: 'var(--heat-4)', marginTop: 10 }}>
          {error} <button type="button" className="btn btn--quiet btn--sm" onClick={() => void generate()}>Retry</button>
        </p>
      )}
      {saved && (
        <p className="text-sm" style={{ color: 'var(--ink)', marginTop: 10 }}>
          Draft saved: <Link href={`/reports/sheet/${saved.id}`} className="hover:underline" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {saved.title || 'view the report'}
          </Link>
          {' '}· review it, then publish from the drafts list below.
          {saved.dropped.length > 0 && (
            <span style={{ color: 'var(--faint-ink)' }}>
              {' '}The citation gate stripped {saved.dropped.length} link{saved.dropped.length === 1 ? '' : 's'} the pack could not vouch for.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

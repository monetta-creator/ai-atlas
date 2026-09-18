'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  buildToolingPackAction, generateToolingSectionsAction, generateToolingCloseAction, saveToolingReportAction,
  setToolingReportPublishedAction,
} from '@/lib/actions';
import type { ToolingSectionsOut } from '@/lib/tooling/reports';
import type { ToolingPack, ToolingCategory } from '@/lib/types';
import type { ToolingReportMeta } from '@/lib/data';
import { SHEET_KIND_LABEL, dateLabel } from '@/lib/format';

// The AI Tooling Monitor's report console: four kind cards, one params form
// per kind, a shared steering note, and the SheetConsole chain (pack ->
// sections -> close -> save) with client retries. A portal keyholder can
// run this whole chain, not just an admin; the console never auto-publishes
// (only the weekly entrants cron does that), so every save here lands as a
// draft on the list below, admin publish/unpublish only.

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

type Kind = 'tooling_landscape' | 'tooling_brief' | 'tooling_entrants' | 'tooling_features';

const CARDS: { kind: Kind; name: string; desc: string }[] = [
  { kind: 'tooling_landscape', name: 'Category landscape', desc: 'One category on the dimensions that matter: deployment, pricing, maturity, compliance, buyer, integrations.' },
  { kind: 'tooling_brief', name: 'Build or buy brief', desc: 'A capability in your own words: what the market offers, and a build-or-buy read.' },
  { kind: 'tooling_entrants', name: 'New entrants', desc: 'Products first seen in a window, plus moves on already-cataloged products. The Monday cron writes and publishes one every week.' },
  { kind: 'tooling_features', name: 'Feature sheet', desc: 'The feature matrix of a category: who does what, and what is worth stealing.' },
];

const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'deployment', label: 'Deployment' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'maturity', label: 'Maturity' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'buyer', label: 'Buyer' },
  { key: 'integrations', label: 'Integrations' },
];

const AUDIENCES = ['executive', 'engineering', 'procurement'] as const;

const STEPS = [
  { running: 'Building the report pack…' },
  { running: 'Writing the cited narrative…' },
  { running: 'Writing the bottom line…' },
  { running: 'Saving the draft…' },
] as const;

function defaultWeek(): { from: string; to: string } {
  // Captured at mount (a client-only component; the same "now at load" idiom
  // as ViewData.tsx), not recomputed on every render.
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ToolingReportConsole({
  categories, reports, admin,
}: {
  categories: ToolingCategory[];
  reports: ToolingReportMeta[];
  admin: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('tooling_landscape');
  const [steering, setSteering] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; dropped: string[] } | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);

  // Landscape
  const [lCategory, setLCategory] = useState('');
  const [lDims, setLDims] = useState<Set<string>>(new Set());
  const [lAudience, setLAudience] = useState<typeof AUDIENCES[number]>('executive');

  // Brief
  const [bCapability, setBCapability] = useState('');
  const [bContext, setBContext] = useState('');
  const [bCategory, setBCategory] = useState('');

  // Entrants
  const [week] = useState(defaultWeek);
  const [eFrom, setEFrom] = useState(week.from);
  const [eTo, setETo] = useState(week.to);
  const [eCategories, setECategories] = useState<Set<string>>(new Set());

  // Features
  const [fCategory, setFCategory] = useState('');
  const [fFocus, setFFocus] = useState('');

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  function buildParams(): Record<string, unknown> {
    switch (kind) {
      case 'tooling_landscape':
        return { category: lCategory, dimensions: [...lDims], audience: lAudience };
      case 'tooling_brief':
        return { capability: bCapability, ourContext: bContext.trim() || null, category: bCategory || null };
      case 'tooling_entrants':
        return { from: eFrom, to: eTo, categories: [...eCategories] };
      case 'tooling_features':
        return { category: fCategory, focus: fFocus.trim() || null };
    }
  }

  const canRun =
    !running &&
    (kind !== 'tooling_landscape' || !!lCategory) &&
    (kind !== 'tooling_brief' || bCapability.trim().length >= 3) &&
    (kind !== 'tooling_entrants' || (!!eFrom && !!eTo)) &&
    (kind !== 'tooling_features' || !!fCategory);

  async function generate() {
    if (!canRun) return;
    setError(null);
    setSaved(null);
    const params = buildParams();
    try {
      setRunning(STEPS[0].running);
      const packRes = await withRetry(() => buildToolingPackAction(kind, params));
      if (!packRes.ok) throw new Error(packRes.error);
      const pack: ToolingPack = packRes.pack;

      setRunning(STEPS[1].running);
      const steer = steering.trim() || null;
      const secRes = await withRetry(() => generateToolingSectionsAction(pack, steer));
      if (!secRes.ok) throw new Error(secRes.error);
      const sections: ToolingSectionsOut = secRes.sections;

      setRunning(STEPS[2].running);
      const closeRes = await withRetry(() => generateToolingCloseAction(pack, {
        readingMd: sections.readingMd, connectionsMd: sections.connectionsMd, watchMd: sections.watchMd,
      }));
      if (!closeRes.ok) throw new Error(closeRes.error);

      setRunning(STEPS[3].running);
      const saveRes = await saveToolingReportAction({
        title: closeRes.title,
        pack,
        narrative: {
          reading: sections.readingHtml || null,
          connections: sections.connectionsHtml || null,
          watch: sections.watchHtml || null,
          bottomLine: closeRes.bottomLineHtml || null,
        },
      });
      if (!saveRes.ok) throw new Error(saveRes.error);

      setSaved({
        id: saveRes.id,
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

  async function togglePublish(id: string, on: boolean) {
    setBusyReportId(id);
    try {
      await setToolingReportPublishedAction(id, on);
      router.refresh();
    } finally {
      setBusyReportId(null);
    }
  }

  const categoryOptions = categories.slice().sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div>
      <div className="lobby-grid" style={{ marginBottom: 'var(--gap)' }}>
        {CARDS.map((c) => (
          <button
            key={c.kind}
            type="button"
            className="lobby-tile"
            style={{
              minHeight: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit',
              borderColor: kind === c.kind ? 'var(--accent)' : undefined,
            }}
            aria-pressed={kind === c.kind}
            onClick={() => { setKind(c.kind); setSaved(null); setError(null); }}
          >
            <span className="lobby-tile-name">{c.name}</span>
            <span className="lobby-tile-desc">{c.desc}</span>
            <span className="lobby-tile-stat" style={kind === c.kind ? { color: 'var(--accent)' } : undefined}>
              {kind === c.kind ? 'Selected' : 'Select'}
            </span>
          </button>
        ))}
      </div>

      {kind === 'tooling_landscape' && (
        <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 12 }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="tr-l-category">Category</label>
            <select id="tr-l-category" className="input" value={lCategory} onChange={(e) => setLCategory(e.target.value)}>
              <option value="">Pick a category…</option>
              {categoryOptions.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="tr-l-audience">Audience</label>
            <select id="tr-l-audience" className="input" value={lAudience}
              onChange={(e) => setLAudience(e.target.value as typeof AUDIENCES[number])}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a[0].toUpperCase()}{a.slice(1)}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <span style={{ display: 'block', marginBottom: 4 }}>Emphasize</span>
            <div className="flex items-center gap-3 flex-wrap">
              {DIMENSIONS.map((d) => (
                <label key={d.key} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--dim)' }}>
                  <input type="checkbox" checked={lDims.has(d.key)} onChange={() => toggleIn(lDims, setLDims, d.key)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {kind === 'tooling_brief' && (
        <div className="flex flex-col gap-3" style={{ marginBottom: 12 }}>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="field" style={{ flex: 1, minWidth: 280 }}>
              <label htmlFor="tr-b-capability">Capability (in your own words)</label>
              <input id="tr-b-capability" className="input" maxLength={300} value={bCapability}
                onChange={(e) => setBCapability(e.target.value)}
                placeholder="e.g. contract clause extraction for loan documents" />
            </div>
            <div className="field" style={{ minWidth: 200 }}>
              <label htmlFor="tr-b-category">Category (optional)</label>
              <select id="tr-b-category" className="input" value={bCategory} onChange={(e) => setBCategory(e.target.value)}>
                <option value="">Any category</option>
                {categoryOptions.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tr-b-context">Our context (optional)</label>
            <textarea id="tr-b-context" className="input" rows={3} maxLength={2000} value={bContext}
              onChange={(e) => setBContext(e.target.value)}
              placeholder="What we already have, budget, timeline, constraints…" />
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 4 }}>
              Stays hidden from guests and is never quoted verbatim; it only shapes the build-or-buy read.
            </p>
          </div>
        </div>
      )}

      {kind === 'tooling_entrants' && (
        <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 12 }}>
          <div className="field">
            <label htmlFor="tr-e-from">From</label>
            <input id="tr-e-from" type="date" className="input" value={eFrom} onChange={(e) => setEFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tr-e-to">To</label>
            <input id="tr-e-to" type="date" className="input" value={eTo} onChange={(e) => setETo(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <span style={{ display: 'block', marginBottom: 4 }}>Categories (optional; empty means every category)</span>
            <div className="flex items-center gap-3 flex-wrap">
              {categoryOptions.map((c) => (
                <label key={c.slug} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--dim)' }}>
                  <input type="checkbox" checked={eCategories.has(c.slug)} onChange={() => toggleIn(eCategories, setECategories, c.slug)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {kind === 'tooling_features' && (
        <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 12 }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="tr-f-category">Category</label>
            <select id="tr-f-category" className="input" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
              <option value="">Pick a category…</option>
              {categoryOptions.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="tr-f-focus">Focus (optional)</label>
            <input id="tr-f-focus" className="input" maxLength={300} value={fFocus} onChange={(e) => setFFocus(e.target.value)}
              placeholder="e.g. audit trails and citation support" />
          </div>
        </div>
      )}

      <div className="field" style={{ marginBottom: 12, maxWidth: 640 }}>
        <label htmlFor="tr-steering">Steering note (optional)</label>
        <textarea id="tr-steering" className="input" rows={2} maxLength={1500} value={steering}
          onChange={(e) => setSteering(e.target.value)}
          placeholder="Your current priorities for this report, if any." />
      </div>

      <button type="button" className="btn btn--primary" disabled={!canRun} onClick={() => void generate()}>
        {running ? 'Generating…' : 'Generate report'}
      </button>

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
          {' '}· <a href={`/reports/sheet/${saved.id}/pdf`} style={{ color: 'var(--accent)' }}>PDF</a>
          {admin && ' · publish from the list below to make it public'}
          {saved.dropped.length > 0 && (
            <span style={{ color: 'var(--faint-ink)' }}>
              {' '}The citation gate stripped {saved.dropped.length} link{saved.dropped.length === 1 ? '' : 's'} the pack could not vouch for.
            </span>
          )}
        </p>
      )}

      <div className="section-label" style={{ marginTop: 30 }}>Past tooling reports</div>
      {reports.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
          No tooling reports yet. Generate one above, or wait for Monday&apos;s new-entrants run.
        </p>
      )}
      <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
        {reports.map((r) => (
          <div key={r.id} className="plate" style={{ display: 'block' }}>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div style={{ flex: 1, minWidth: 240 }}>
                <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{r.title}</span>
                <div className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {SHEET_KIND_LABEL[r.kind as keyof typeof SHEET_KIND_LABEL] ?? r.kind}
                  {r.subject ? ` · ${r.subject}` : ''}
                  {r.scope_from || r.scope_to ? ` · ${r.scope_from ?? 'start'} to ${r.scope_to ?? 'now'}` : ''}
                  {dateLabel(r.generated_at) ? ` · ${dateLabel(r.generated_at)}` : ''}
                  {' · '}{r.is_published ? 'published' : 'draft'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/reports/sheet/${r.id}`} className="btn btn--ghost btn--sm">Read</Link>
                <a href={`/reports/sheet/${r.id}/pdf`} className="btn btn--ghost btn--sm">PDF</a>
                {admin && (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busyReportId === r.id}
                    onClick={() => void togglePublish(r.id, !r.is_published)}>
                    {r.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                )}
              </div>
            </div>
            {admin && !r.is_published && r.kind === 'tooling_brief' && (
              <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 8 }}>
                Publishing makes the narrative public; the internal context stays hidden.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

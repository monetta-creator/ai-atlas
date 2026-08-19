'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  intelSweepAction, enrichCompanyAction, extractCompanyDocAction,
  reExtractDocAction, deleteCompanyDocAction, competitorScanAction,
} from '@/lib/actions';
import type { CompanyDocument } from '@/lib/types';

// The per-company research surface (admin + portal keyholders): one steering
// instruction shared by every tool, then the tools. The steering is a one-off
// argument to the call, never persisted. PDF text is extracted in the BROWSER
// (the ingest form's unpdf pattern): the file bytes never leave the machine,
// only sanitized text reaches the server (capped at 200k chars, well under the
// server-action body limit). Data arrives as props only; this component must
// never import server modules.

const TEXT_CAP = 200_000;

export default function ResearchPanel({
  id, isAdmin, hasUrl, documents,
}: {
  id: string;
  isAdmin: boolean;
  hasUrl: boolean;
  documents: CompanyDocument[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [steering, setSteering] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const push = (s: string) => setLog((l) => [...l, s]);

  const doneLine = (label: string, r: { filled?: string[]; events?: number; skipped?: number }) =>
    `✓ ${label}.${r.filled?.length ? ` Filled: ${r.filled.join(', ')}.` : ''} ${r.events ?? 0} event${(r.events ?? 0) === 1 ? '' : 's'} logged${r.skipped ? `, ${r.skipped} skipped` : ''}.`;

  function runSweep() {
    setBusy('sweep');
    setLog([]);
    push('Searching the web for the company…');
    startTransition(async () => {
      try {
        const r = await intelSweepAction(id, steering);
        if (r.ok) { push(doneLine('Sweep done', r)); router.refresh(); }
        else push(`✗ ${r.error ?? 'The sweep failed.'}`);
      } finally {
        setBusy(null);
      }
    });
  }

  function runEnrich() {
    setBusy('enrich');
    setLog([]);
    push('Fetching the homepage…');
    startTransition(async () => {
      try {
        const r = await enrichCompanyAction(id);
        if (r.ok) { push(`✓ Dossier updated.${r.filled?.length ? ` Filled: ${r.filled.join(', ')}.` : ''}`); router.refresh(); }
        else push(`✗ ${r.error ?? 'Enrichment failed.'}`);
      } finally {
        setBusy(null);
      }
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { setLog(['✗ That does not look like a PDF. Choose a .pdf file.']); return; }
    if (file.size > 100 * 1024 * 1024) { setLog(['✗ That PDF is very large (over 100MB).']); return; }

    setBusy('doc');
    setLog([`Extracting text from ${file.name}…`]);
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const { text: extracted } = await extractText(pdf, { mergePages: true });
      const clean = (extracted ?? '').trim();
      if (!clean) {
        push('✗ No selectable text in that PDF. It looks scanned.');
        setBusy(null);
        return;
      }
      let body = clean;
      if (body.length > TEXT_CAP) {
        body = body.slice(0, TEXT_CAP);
        push(`Truncated to ${TEXT_CAP.toLocaleString()} characters.`);
      }
      push(`Extracted ${body.length.toLocaleString()} characters, reading…`);
      startTransition(async () => {
        try {
          const r = await extractCompanyDocAction(id, file.name, body, steering);
          if (r.ok) { push(doneLine('Document read', r)); router.refresh(); }
          else push(`✗ ${r.error ?? 'The extraction failed.'}`);
        } finally {
          setBusy(null);
        }
      });
    } catch (err) {
      push(`✗ Could not read that PDF (${err instanceof Error ? err.message : 'unknown error'}).`);
      setBusy(null);
    }
  }

  function runCompetitors() {
    setBusy('comp');
    setLog([]);
    push('Searching the web for similar young companies…');
    startTransition(async () => {
      try {
        const r = await competitorScanAction(id, steering);
        if (r.ok) {
          push(`✓ Scan done: ${r.found ?? 0} found, ${r.inserted ?? 0} new in the review queue.${r.names?.length ? ` (${r.names.slice(0, 8).join(', ')}${(r.names.length > 8) ? ', …' : ''})` : ''}`);
          router.refresh();
        } else {
          push(`✗ ${r.error ?? 'The scan failed.'}`);
        }
      } finally {
        setBusy(null);
      }
    });
  }

  function runReExtract(docId: string) {
    setBusy(`re:${docId}`);
    setLog(['Re-reading the document…']);
    startTransition(async () => {
      try {
        const r = await reExtractDocAction(docId, steering);
        if (r.ok) { push(doneLine('Document re-read', r)); router.refresh(); }
        else push(`✗ ${r.error ?? 'The extraction failed.'}`);
      } finally {
        setBusy(null);
      }
    });
  }

  function runDeleteDoc(docId: string) {
    setBusy(`del:${docId}`);
    startTransition(async () => {
      try {
        await deleteCompanyDocAction(docId);
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="rp-steering">Steering (optional, applies to the next run only)</label>
        <textarea
          id="rp-steering"
          className="input"
          rows={2}
          maxLength={1000}
          placeholder="e.g. Focus on their claims-processing tech and any named insurance customers."
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn--primary btn--sm" disabled={!!busy || pending} onClick={runSweep}>
          {busy === 'sweep' ? 'Sweeping…' : '✦ Web intel sweep'}
        </button>
        <label className={`btn btn--ghost btn--sm${busy || pending ? ' opacity-50 pointer-events-none' : ''}`} style={{ cursor: 'pointer' }}>
          {busy === 'doc' ? 'Reading…' : 'Upload a document…'}
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFile}
            style={{ display: 'none' }}
            disabled={!!busy || pending}
          />
        </label>
        {isAdmin && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!busy || pending}
            title="Find similar young companies and queue them for review"
            onClick={runCompetitors}
          >
            {busy === 'comp' ? 'Scanning…' : '✦ Find competitors'}
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!busy || pending || !hasUrl}
            title={hasUrl ? 'Fetch the homepage and extract a dossier' : 'Add a homepage URL first'}
            onClick={runEnrich}
          >
            {busy === 'enrich' ? 'Enriching…' : '✦ Refresh homepage dossier'}
          </button>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
        The sweep searches the web for funding, product, team, and news. A document
        upload extracts a PDF&apos;s text in your browser (the file never leaves your
        machine) and reads it here. Facts fill only empty fields; new developments land
        on the timeline. Nothing here changes the review status.
      </p>

      {documents.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            Documents · {documents.length}
          </div>
          {documents.map((d) => (
            <div
              key={d.id}
              className="flex items-baseline flex-wrap gap-2 text-xs rounded-[var(--radius)] border p-2"
              style={{ borderColor: 'var(--line)' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{d.filename}</span>
              <span style={{ color: 'var(--faint-ink)' }}>
                {d.created_at} · {d.char_count.toLocaleString()} chars · {d.origin}
              </span>
              <span style={{ marginLeft: 'auto' }} className="flex items-center gap-2">
                <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || pending} onClick={() => runReExtract(d.id)}>
                  {busy === `re:${d.id}` ? 'Reading…' : 'Re-extract'}
                </button>
                {isAdmin && (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={!!busy || pending} onClick={() => runDeleteDoc(d.id)}>
                    {busy === `del:${d.id}` ? '…' : '✕'}
                  </button>
                )}
              </span>
              {d.doc_summary && (
                <span style={{ color: 'var(--dim)', width: '100%' }}>{d.doc_summary}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <pre
          className="text-xs"
          role="status"
          aria-live="polite"
          style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}

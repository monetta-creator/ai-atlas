'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  intelSweepAction, enrichCompanyAction, extractCompanyDocAction,
  reExtractDocAction, deleteCompanyDocAction, competitorScanAction,
} from '@/lib/actions';
import type { CompanyDocument } from '@/lib/types';
import { useModelRun } from '@/lib/jobs/use-model-run';
import ModelCallButton from '@/components/jobs/ModelCallButton';
import ModelRunPanel from '@/components/jobs/ModelRunPanel';

// The per-company research surface (admin + portal keyholders): one steering
// instruction shared by every tool, then the tools. The steering is a one-off
// argument to the call, never persisted. PDF text is extracted in the BROWSER
// (the ingest form's unpdf pattern): the file bytes never leave the machine,
// only sanitized text reaches the server (capped at 200k chars, well under the
// server-action body limit). Data arrives as props only; this component must
// never import server modules.
//
// Every model call runs through the shared job toolkit (2026-09-27): each
// tool is its own ModelCallButton (or, for the document upload, a two-step
// useModelRun since one click both extracts text in the browser and calls the
// server) so a run survives leaving the page and shows up in the rail.

const TEXT_CAP = 200_000;

const doneLine = (label: string, r: { filled?: string[]; events?: number; skipped?: number }) =>
  `✓ ${label}.${r.filled?.length ? ` Filled: ${r.filled.join(', ')}.` : ''} ${r.events ?? 0} event${(r.events ?? 0) === 1 ? '' : 's'} logged${r.skipped ? `, ${r.skipped} skipped` : ''}.`;

export default function ResearchPanel({
  id, isAdmin, hasUrl, documents,
}: {
  id: string;
  isAdmin: boolean;
  hasUrl: boolean;
  documents: CompanyDocument[];
}) {
  const router = useRouter();
  const [steering, setSteering] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const docFile = useRef<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [delPending, startDelete] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sweepFeature = isAdmin ? 'scout_intel' : 'portal_scout';
  const docFeature = isAdmin ? 'scout_doc' : 'portal_scout';

  const docRun = useModelRun({
    kind: `single:${docFeature}`,
    subject: id,
    label: 'Document read',
    steps: [
      { key: 'extract', label: 'Extract text', running: 'Extracting text from the PDF…' },
      { key: 'call', label: 'Read the document', running: 'Reading, extracting facts…', features: [docFeature] },
    ],
    run: async (ctx) => {
      const file = docFile.current;
      if (!file) throw new Error('No file selected.');
      const { filename, text } = await ctx.step('extract', async () => {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const buf = new Uint8Array(await file.arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        const { text: extracted } = await extractText(pdf, { mergePages: true });
        const clean = (extracted ?? '').trim();
        if (!clean) throw new Error('No selectable text in that PDF. It looks scanned.');
        let body = clean;
        if (body.length > TEXT_CAP) {
          body = body.slice(0, TEXT_CAP);
          ctx.note(`Truncated to ${TEXT_CAP.toLocaleString()} characters.`);
        }
        return { filename: file.name, text: body };
      });
      const r = await ctx.step('call', () => extractCompanyDocAction(id, filename, text, steering), { retries: 1 });
      if (!r.ok) throw new Error(r.error ?? 'The extraction failed.');
      router.refresh();
      return { note: doneLine('Document read', r) };
    },
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setPickError(null);
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { setPickError('That does not look like a PDF. Choose a .pdf file.'); return; }
    if (file.size > 100 * 1024 * 1024) { setPickError('That PDF is very large (over 100MB).'); return; }
    docFile.current = file;
    void docRun.start();
  }

  function runDeleteDoc(docId: string) {
    setDeletingId(docId);
    startDelete(async () => {
      try {
        await deleteCompanyDocAction(docId);
        router.refresh();
      } finally {
        setDeletingId(null);
      }
    });
  }

  const anyBusy = docRun.status === 'running' || delPending;

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
          disabled={anyBusy}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ModelCallButton
          label="✦ Web intel sweep"
          busyLabel="Searching the web for the company…"
          kind={`single:${sweepFeature}`}
          subject={id}
          jobLabel="Web intel sweep"
          feature={sweepFeature}
          retries={1}
          className="btn btn--primary btn--sm"
          action={() => intelSweepAction(id, steering)}
          onDone={(r) => {
            router.refresh();
            return { note: doneLine('Sweep done', r) };
          }}
        />
        <label className={`btn btn--ghost btn--sm${anyBusy ? ' opacity-50 pointer-events-none' : ''}`} style={{ cursor: 'pointer' }}>
          {docRun.status === 'running' ? 'Reading…' : 'Upload a document…'}
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFile}
            style={{ display: 'none' }}
            disabled={anyBusy}
          />
        </label>
        {isAdmin && (
          <span title="Find similar young companies and queue them for review">
            <ModelCallButton
              label="✦ Find competitors"
              busyLabel="Searching the web for similar young companies…"
              kind="single:scout_competitors"
              subject={id}
              jobLabel="Competitor scan"
              feature="scout_competitors"
              retries={1}
              className="btn btn--ghost btn--sm"
              action={() => competitorScanAction(id, steering)}
              onDone={(r) => {
                router.refresh();
                return {
                  note: `✓ Scan done: ${r.found ?? 0} found, ${r.inserted ?? 0} new in the review queue.${r.names?.length ? ` (${r.names.slice(0, 8).join(', ')}${r.names.length > 8 ? ', …' : ''})` : ''}`,
                };
              }}
            />
          </span>
        )}
        {isAdmin && (
          <span title={hasUrl ? 'Fetch the homepage and extract a dossier' : 'Add a homepage URL first'}>
            <ModelCallButton
              label="✦ Refresh homepage dossier"
              busyLabel="Fetching the homepage…"
              kind="single:scout_dossier"
              subject={id}
              jobLabel="Homepage dossier refresh"
              feature="scout_dossier"
              retries={1}
              disabled={!hasUrl}
              className="btn btn--ghost btn--sm"
              action={() => enrichCompanyAction(id)}
              onDone={(r) => {
                router.refresh();
                return { note: `✓ Dossier updated.${r.filled?.length ? ` Filled: ${r.filled.join(', ')}.` : ''}` };
              }}
            />
          </span>
        )}
      </div>

      {pickError && <p className="text-xs" style={{ color: 'var(--danger, #b42318)' }}>✗ {pickError}</p>}

      <ModelRunPanel run={docRun} />

      <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
        The sweep searches the web for funding, product, team, and news. A document
        upload extracts a PDF&apos;s text in your browser: the file itself is not uploaded,
        but the extracted text is sent to the server, stored with the company record, and
        passed to the model. Facts fill only empty fields; new developments land on the
        timeline. Nothing here changes the review status.
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
                <ModelCallButton
                  label="Re-extract"
                  busyLabel="Re-reading the document…"
                  kind={`single:${docFeature}`}
                  subject={d.id}
                  jobLabel={`Document re-read: ${d.filename}`}
                  feature={docFeature}
                  retries={1}
                  disabled={deletingId === d.id}
                  className="btn btn--quiet btn--sm"
                  action={() => reExtractDocAction(d.id, steering)}
                  onDone={(r) => {
                    router.refresh();
                    return { note: doneLine('Document re-read', r) };
                  }}
                />
                {isAdmin && (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={delPending} onClick={() => runDeleteDoc(d.id)}>
                    {deletingId === d.id ? '…' : '✕'}
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
    </div>
  );
}

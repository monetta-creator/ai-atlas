'use client';

import { useRef, useState } from 'react';
import { createSourceAction, extractSourceMetadataAction } from '@/lib/actions';

const DOMAIN_OPTIONS: [string, string][] = [
  ['', '–'],
  ['capability', 'Capability'],
  ['economics', 'Economics'],
  ['build_out', 'Build-out'],
  ['market', 'Market'],
  ['labor', 'Labor'],
];

// Controlled add-source form. Picking a PDF extracts its text in-browser (unpdf)
// and then asks the server for bibliographic metadata, auto-filling any blank
// fields (title/author/url/date/domain). Everything stays editable; the form
// still submits to the createSourceAction server action.
export default function SourceForm() {
  const [title, setTitle] = useState('');
  const [outlet, setOutlet] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [published, setPublished] = useState('');
  const [domain, setDomain] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { setError(true); setStatus('That doesn’t look like a PDF. Choose a .pdf file.'); return; }
    if (file.size > 100 * 1024 * 1024) { setError(true); setStatus('That PDF is very large (over 100MB).'); return; }

    setBusy(true); setError(false); setStatus(`Extracting text from ${file.name}…`);
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const { text: extracted } = await extractText(pdf, { mergePages: true });
      const clean = (extracted ?? '').trim();
      if (!clean) {
        setError(true);
        setStatus(`No selectable text in ${file.name}. It looks scanned. Fill the fields manually.`);
        return;
      }
      setText((prev) => (prev.trim() ? prev : clean));
      setStatus(`Extracted ${clean.length.toLocaleString()} characters, reading metadata…`);

      const meta = await extractSourceMetadataAction(clean);
      setTitle((v) => v || meta.title);
      setAuthor((v) => v || meta.author);
      setUrl((v) => v || meta.url);
      setPublished((v) => v || meta.published_at);
      setDomain((v) => v || meta.domain_tag);
      const filled = [
        meta.title && 'title', meta.author && 'author', meta.url && 'URL',
        meta.published_at && 'date', meta.domain_tag && 'domain',
      ].filter(Boolean);
      setStatus(
        filled.length
          ? `Auto-filled ${filled.join(', ')} from the PDF. Review and edit below.`
          : 'Text extracted; no metadata could be read. Fill the fields manually.'
      );
    } catch (err) {
      setError(true);
      const msg = err instanceof Error ? err.message : 'unknown error';
      setStatus(`Couldn’t read that PDF (${msg}). Fill the fields manually.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      action={createSourceAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      {/* PDF picker — extracts text + auto-fills metadata */}
      <div className="field">
        <label>Start from a PDF (optional)</label>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="btn btn--ghost btn--sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M8 10.5V2.5M8 2.5 5 5.5M8 2.5l3 3M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {busy ? 'Reading…' : 'Upload PDF & auto-fill'}
            <input ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={handleFile} disabled={busy} style={{ display: 'none' }} />
          </label>
          {status && (
            <span className="text-xs" role="status" aria-live="polite" style={{ color: error ? 'var(--heat-4)' : 'var(--faint-ink)' }}>
              {status}
            </span>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Compute Glut Is Coming" />
        </div>
        <div className="field">
          <label htmlFor="outlet">Outlet</label>
          <input id="outlet" name="outlet" className="input" value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="e.g. SemiAnalysis" />
        </div>
        <div className="field">
          <label htmlFor="author">Author</label>
          <input id="author" name="author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Dylan Patel" />
        </div>
        <div className="field">
          <label htmlFor="url">URL</label>
          <input id="url" name="url" type="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label htmlFor="published_at">Published</label>
          <input id="published_at" name="published_at" type="date" className="input" value={published} onChange={(e) => setPublished(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="domain_tag">Domain (suggested)</label>
          <select id="domain_tag" name="domain_tag" className="input" value={domain} onChange={(e) => setDomain(e.target.value)}>
            {DOMAIN_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="reliability_prior">Reliability prior (0–100)</label>
        <input id="reliability_prior" name="reliability_prior" type="number" min={0} max={100} className="input" placeholder="e.g. 70" />
      </div>

      <div className="field">
        <label htmlFor="raw_text">Source text: paste it, or upload a PDF above</label>
        <textarea
          id="raw_text"
          name="raw_text"
          rows={8}
          className="input"
          style={{ resize: 'vertical' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the source text here, or upload a PDF above to extract it…"
        />
      </div>

      <div>
        <button type="submit" className="btn btn--primary" disabled={busy} style={busy ? { opacity: 0.6 } : undefined}>
          Create source →
        </button>
      </div>
    </form>
  );
}

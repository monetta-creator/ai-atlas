'use client';

import { useState } from 'react';
import { addPaperAction } from '@/lib/actions';

// Manual "Add paper" — the staleness-gap door. An arXiv link/id auto-fills from the
// API; the non-arXiv mode (NBER, SSRN, lab reports) takes url + title by hand. Both
// enter the review queue pre-approved (triage 'kept'): human before the expensive call.
export default function AddPaperForm() {
  const [mode, setMode] = useState<'arxiv' | 'other'>('arxiv');

  return (
    <form
      action={addPaperAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`btn btn--sm ${mode === 'arxiv' ? 'btn--ghost' : 'btn--quiet'}`}
          onClick={() => setMode('arxiv')}
        >
          arXiv link
        </button>
        <button
          type="button"
          className={`btn btn--sm ${mode === 'other' ? 'btn--ghost' : 'btn--quiet'}`}
          onClick={() => setMode('other')}
        >
          Other paper (NBER, SSRN, lab report)
        </button>
      </div>

      {mode === 'arxiv' ? (
        <div className="field">
          <label htmlFor="paper-ref">arXiv URL or id</label>
          <input
            id="paper-ref" name="ref" className="input" required
            placeholder="https://arxiv.org/abs/2607.07708 or 2607.07708"
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="paper-url">URL</label>
            <input id="paper-url" name="url" className="input" type="url" required placeholder="https://…" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="paper-title">Title</label>
            <input id="paper-title" name="title" className="input" required />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="paper-abstract">Abstract (optional)</label>
            <textarea id="paper-abstract" name="abstract" className="input" rows={3} />
          </div>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn--primary btn--sm">Add to review queue</button>
      </div>
    </form>
  );
}

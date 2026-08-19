'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createThesisAction } from '@/lib/actions';

// The /map thesis entry (admin only): type the hypothesis, click Create thesis.
// The thesis is created unmapped and you land on its workflow page with the
// mapping form open, so "Map to Atlas claims" is the next click. This is the
// deal workflow's step 1 made literal at the top of the page.
export default function ThesisDraftBox() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [statement, setStatement] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const s = statement.trim();
    if (!s) return;
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await createThesisAction({ statement: s, claimCodes: [] });
        router.push(`/theses/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the thesis.');
      }
    });
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="input"
          style={{ flex: '1 1 380px', fontSize: 15 }}
          maxLength={500}
          placeholder="Draft a thesis: a hypothesis in plain language, e.g. AI coding tools shrink enterprise software teams within two years."
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          disabled={pending}
          aria-label="Thesis statement"
        />
        <button
          type="button"
          className="btn btn--primary"
          onClick={submit}
          disabled={pending || !statement.trim()}
        >
          {pending ? 'Creating…' : 'Create thesis'}
        </button>
      </div>
      {error && <p className="editable-error" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}

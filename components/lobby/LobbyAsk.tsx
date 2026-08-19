'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ExamplePill from '@/components/ask/ExamplePill';

// The lobby's chat launcher. No API calls here: the question rides ?q= into
// the /ask workspace, which auto-fires it as the conversation's first turn.
// While the box is empty and unfocused, a blinking accent caret invites
// typing (the real caret, also accent, takes over on focus); beneath it, the
// ExamplePill types out rotating example questions.
export default function LobbyAsk() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function go(text: string) {
    const t = text.trim().slice(0, 2000);
    router.push(t ? `/ask?q=${encodeURIComponent(t)}` : '/ask');
  }

  return (
    <div className="lobby-launch">
      <form className="lobby-ask" onSubmit={(e) => { e.preventDefault(); go(q); }}>
        {!q && <span className="lobby-ask-caret" aria-hidden="true" />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the Atlas: cited answers over signals, claims, evidence, and theses"
          aria-label="Ask the Atlas"
        />
        <button type="submit" className="btn btn--primary">Ask</button>
      </form>
      <ExamplePill onPick={go} />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { EXAMPLE_QUESTIONS } from '@/components/ask/starters';

// The example-question pill: types a question out character by character,
// holds, deletes it, and types the next. Tapping it asks the question
// currently showing; the loop pauses under the pointer so the target never
// changes mid-reach. Under prefers-reduced-motion the typing is skipped and
// questions simply rotate whole. All timing runs through one self-scheduling
// timeout keyed on (question, length, phase), so unmount cleanup is a single
// clearTimeout and no state is set synchronously in the effect body.
export default function ExamplePill({
  questions = EXAMPLE_QUESTIONS, onPick,
}: {
  questions?: string[];
  onPick: (question: string) => void;
}) {
  const [i, setI] = useState(0);
  const [len, setLen] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const q = questions[i];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let delay: number;
    let step: () => void;
    if (reduced) {
      if (len !== q.length) {
        delay = 0;
        step = () => { setDeleting(false); setLen(q.length); };
      } else {
        delay = 4500;
        step = () => { setLen(0); setI((v) => (v + 1) % questions.length); };
      }
    } else if (!deleting) {
      if (len < q.length) {
        delay = len === 0 ? 600 : 34;
        step = () => setLen(len + 1);
      } else {
        delay = 2400;
        step = () => setDeleting(true);
      }
    } else if (len > 0) {
      delay = 16;
      step = () => setLen(len - 1);
    } else {
      delay = 300;
      step = () => { setDeleting(false); setI((v) => (v + 1) % questions.length); };
    }
    const t = setTimeout(step, delay);
    return () => clearTimeout(t);
  }, [questions, i, len, deleting, paused]);

  const q = questions[i];
  return (
    <button
      type="button"
      className="lobby-eg"
      onClick={() => onPick(q)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label={`Ask an example question: ${q}`}
    >
      <span className="lobby-eg-kicker">e.g.</span>
      <span className="lobby-eg-q">
        {q.slice(0, len)}
        <span className="lobby-eg-caret" aria-hidden="true" />
      </span>
    </button>
  );
}

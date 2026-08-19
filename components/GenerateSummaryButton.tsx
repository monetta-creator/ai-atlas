'use client';

import { useFormStatus } from 'react-dom';
import { generateQuestionSummaryAction } from '@/lib/actions';

function Btn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="submit"
        className="btn btn--ghost btn--sm"
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: 'wait' } : undefined}
      >
        {pending ? 'Summarizing…' : label}
      </button>
      {pending && (
        <span className="text-[11px]" style={{ color: 'var(--faint-ink)' }}>Analyzing…</span>
      )}
    </span>
  );
}

export default function GenerateSummaryButton({
  questionId,
  slug,
  label = '✦ Summarize state',
}: {
  questionId: string;
  slug: string;
  label?: string;
}) {
  return (
    <form action={generateQuestionSummaryAction}>
      <input type="hidden" name="question_id" value={questionId} />
      <input type="hidden" name="slug" value={slug} />
      <Btn label={label} />
    </form>
  );
}

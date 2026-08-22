import { updateHypothesisAction } from '@/lib/actions';
import { RESOLVABILITY_LABEL } from '@/lib/format';
import type { Hypothesis, Resolvability } from '@/lib/types';

// Edit the hypothesis's text fields (admin). The statement and test are the
// public spine; the note is working context. Conviction is NOT here: it moves
// only through the ConvictionEditor's gate (rationale required).
const RESOLVABILITIES: Resolvability[] = ['clean', 'slow', 'qualitative'];

export default function HypothesisForm({ hypothesis }: { hypothesis: Hypothesis }) {
  const h = hypothesis;
  return (
    <form
      action={updateHypothesisAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <input type="hidden" name="id" value={h.id} />

      <div className="field">
        <label htmlFor="hyp-statement">Statement</label>
        <textarea
          id="hyp-statement"
          name="statement"
          className="input"
          rows={3}
          maxLength={800}
          required
          defaultValue={h.statement}
        />
      </div>

      <div className="field">
        <label htmlFor="hyp-test">Falsified if (the test)</label>
        <textarea
          id="hyp-test"
          name="test"
          className="input"
          rows={2}
          maxLength={2000}
          required
          defaultValue={h.test}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="field">
          <label htmlFor="hyp-resolvability">Resolvability</label>
          <select id="hyp-resolvability" name="resolvability" className="input" defaultValue={h.resolvability ?? ''}>
            <option value="">(unset)</option>
            {RESOLVABILITIES.map((r) => (
              <option key={r} value={r}>{RESOLVABILITY_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hyp-note">Note (working context)</label>
          <input id="hyp-note" name="note" className="input" maxLength={2000} defaultValue={h.note ?? ''} />
        </div>
      </div>

      <div>
        <button type="submit" className="btn btn--primary">Save changes</button>
      </div>
    </form>
  );
}

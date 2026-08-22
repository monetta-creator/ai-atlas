import { createHypothesisAction } from '@/lib/actions';

// The /map hypothesis entry (admin only): state the hypothesis and its
// falsification test, click Create. The action redirects to the new
// hypothesis's page, where evidence, conviction, and reports live.
export default function HypothesisDraftBox() {
  return (
    <form action={createHypothesisAction} style={{ marginBottom: 18 }} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="input"
          style={{ flex: '1 1 380px', fontSize: 15 }}
          maxLength={800}
          name="statement"
          required
          placeholder="Draft a hypothesis in plain language, e.g. AI coding tools shrink enterprise software teams within two years."
          aria-label="Hypothesis statement"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="input"
          style={{ flex: '1 1 380px', fontSize: 14 }}
          maxLength={2000}
          name="test"
          required
          placeholder="Falsified if: what evidence would move or kill it?"
          aria-label="Falsification test"
        />
        <button type="submit" className="btn btn--primary">Create hypothesis</button>
      </div>
    </form>
  );
}

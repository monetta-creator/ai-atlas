import { addTargetAction } from '@/lib/actions';
import { COMPANY_STAGE_LABEL } from '@/lib/format';
import type { CompanyStage, ScoutVertical } from '@/lib/types';

const STAGES = Object.keys(COMPANY_STAGE_LABEL) as CompanyStage[];

// Manual add: enters the funnel as queued, deduped against the whole library
// by domain and normalized name (an existing match routes to its profile).
export default function AddCompanyForm({ verticals }: { verticals: ScoutVertical[] }) {
  return (
    <form
      action={addTargetAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', maxWidth: 560 }}
    >
      <div className="field">
        <label htmlFor="sc-name">Company name</label>
        <input id="sc-name" name="name" className="input" required maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="sc-url">Homepage URL (optional, drives dedupe)</label>
        <input id="sc-url" name="url" className="input" type="url" placeholder="https://" />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sc-vertical">Vertical</label>
          <select id="sc-vertical" name="vertical" className="input" required defaultValue={verticals.find((v) => v.active)?.slug}>
            {verticals.map((v) => (
              <option key={v.slug} value={v.slug}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sc-stage">Stage</label>
          <select id="sc-stage" name="stage" className="input" defaultValue="unknown">
            {STAGES.map((s) => (
              <option key={s} value={s}>{COMPANY_STAGE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 120 }}>
          <label htmlFor="sc-founded">Founded</label>
          <input id="sc-founded" name="founded_year" className="input" inputMode="numeric" placeholder="2023" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="sc-oneliner">One-liner (what they do)</label>
        <input id="sc-oneliner" name="one_liner" className="input" maxLength={300} />
      </div>
      <div className="field">
        <label htmlFor="sc-aitech">The AI tech (the acquisition object)</label>
        <textarea id="sc-aitech" name="ai_tech" className="input" rows={2} maxLength={1000} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="sc-hq">HQ (optional)</label>
          <input id="sc-hq" name="hq" className="input" maxLength={120} />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="sc-funding">Funding note (optional)</label>
          <input id="sc-funding" name="funding_note" className="input" maxLength={200} placeholder="Seed, $8M, 2025, a16z" />
        </div>
      </div>
      <div>
        <button type="submit" className="btn btn--primary btn--sm">Add to the queue</button>
      </div>
    </form>
  );
}

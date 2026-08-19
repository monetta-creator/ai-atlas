import { updateCompanyFactsAction } from '@/lib/actions';
import { COMPANY_STAGE_LABEL } from '@/lib/format';
import type { Company, CompanyStage } from '@/lib/types';

const STAGES = Object.keys(COMPANY_STAGE_LABEL) as CompanyStage[];

// Admin fact edits. The human's text always wins: the enrichment leg fills
// only null columns and never touches an edited field.
export default function CompanyFactsForm({ company }: { company: Company }) {
  return (
    <details>
      <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
        Edit description, stage, funding…
      </summary>
      <form
        action={updateCompanyFactsAction}
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 560 }}
      >
        <input type="hidden" name="id" value={company.id} />
        <div className="field">
          <label htmlFor="cf-oneliner">One-liner</label>
          <input id="cf-oneliner" name="one_liner" className="input" maxLength={300} defaultValue={company.one_liner ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="cf-aitech">The AI tech</label>
          <textarea id="cf-aitech" name="ai_tech" className="input" rows={3} maxLength={1000} defaultValue={company.ai_tech ?? ''} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="cf-stage">Stage</label>
            <select id="cf-stage" name="stage" className="input" defaultValue={company.stage}>
              {STAGES.map((s) => (
                <option key={s} value={s}>{COMPANY_STAGE_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="cf-founded">Founded</label>
            <input id="cf-founded" name="founded_year" className="input" inputMode="numeric" defaultValue={company.founded_year ?? ''} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="cf-hq">HQ</label>
            <input id="cf-hq" name="hq" className="input" maxLength={120} defaultValue={company.hq ?? ''} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cf-funding">Funding note</label>
          <input id="cf-funding" name="funding_note" className="input" maxLength={200} defaultValue={company.funding_note ?? ''} />
        </div>
        <div>
          <button type="submit" className="btn btn--primary btn--sm">Save facts</button>
        </div>
      </form>
    </details>
  );
}

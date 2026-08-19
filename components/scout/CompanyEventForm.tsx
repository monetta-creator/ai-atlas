import { addCompanyEventAction } from '@/lib/actions';
import { COMPANY_EVENT_LABEL } from '@/lib/format';
import type { CompanyEventKind } from '@/lib/types';

const KINDS = Object.keys(COMPANY_EVENT_LABEL) as CompanyEventKind[];

// Admin: log a funding round, launch, or notable news item on the timeline.
export default function CompanyEventForm({ companyId }: { companyId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <details style={{ marginTop: 10 }}>
      <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
        Log an event…
      </summary>
      <form
        action={addCompanyEventAction}
        className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginTop: 8, maxWidth: 560 }}
      >
        <input type="hidden" name="company_id" value={companyId} />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="ev-date">Date</label>
            <input id="ev-date" name="event_date" className="input" type="date" required defaultValue={today} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="ev-kind">Kind</label>
            <select id="ev-kind" name="kind" className="input" defaultValue="news">
              {KINDS.map((k) => (
                <option key={k} value={k}>{COMPANY_EVENT_LABEL[k]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ev-title">Title</label>
          <input id="ev-title" name="title" className="input" required maxLength={300} />
        </div>
        <div className="field">
          <label htmlFor="ev-url">URL (optional)</label>
          <input id="ev-url" name="url" className="input" type="url" placeholder="https://" />
        </div>
        <div className="field">
          <label htmlFor="ev-note">Note (optional)</label>
          <input id="ev-note" name="note" className="input" maxLength={500} />
        </div>
        <div>
          <button type="submit" className="btn btn--primary btn--sm">Log it</button>
        </div>
      </form>
    </details>
  );
}

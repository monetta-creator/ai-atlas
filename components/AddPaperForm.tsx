// Manual "Add paper": url + title (+ optional abstract) by hand. Enters the
// review queue pre-approved (triage 'kept'): a human chose it. The document's
// text arrives via a linked source (Send to research from a source page).
import { addPaperAction } from '@/lib/actions';

export default function AddPaperForm() {
  return (
    <form
      action={addPaperAction}
      className="rounded-[var(--radius)] border p-[var(--card-pad)]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="field">
        <label htmlFor="paper-url">URL or internal reference</label>
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
      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn--primary btn--sm">Add to review queue</button>
      </div>
    </form>
  );
}

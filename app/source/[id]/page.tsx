import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getSource, getTargets } from '@/lib/data';
import { setPriorAction, reassignEvidenceAction, deleteEvidenceAction } from '@/lib/actions';
import { directionLabel, directionColor } from '@/lib/format';
import Header from '@/components/Header';
import EvidenceForm from '@/components/EvidenceForm';
import DossierView from '@/components/DossierView';
import GenerateDossierButton from '@/components/GenerateDossierButton';
import DeleteSourceButton from '@/components/DeleteSourceButton';
import TurnIntoSignalButton from '@/components/TurnIntoSignalButton';
import SendToResearchButton from '@/components/SendToResearchButton';

const truncate = (s: string, n = 64) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const dynamic = 'force-dynamic';
// The dossier action runs an Anthropic call; give its server action
// room (Next applies page-level maxDuration to the page's Server Actions).
export const maxDuration = 60;

export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = await requireAdminPage();

  const data = await getSource(id);
  if (!data) notFound();
  const { source, evidence } = data;
  const { hypotheses } = await getTargets();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="crumbs">
            <Link href="/ingest">Sources</Link> / {source.title || 'Untitled source'}
          </div>
          <DeleteSourceButton sourceId={source.id} label={source.title || 'Untitled source'} />
        </div>

        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 32px)' }}>{source.title || 'Untitled source'}</h1>
          <p className="lede" style={{ fontSize: 14.5, marginTop: 8 }}>
            {[source.outlet, source.author].filter(Boolean).join(' · ') || '–'}
            {source.published_at ? ` · ${source.published_at}` : ''}
          </p>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs hover:underline"
              style={{ color: 'var(--accent)', overflowWrap: 'anywhere' }}
            >
              {source.url}
            </a>
          )}
        </header>

        {/* AI source dossier — descriptive profile, not a score. The reliability
            prior is set below, separately. */}
        <section className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ margin: '36px 0 16px' }}>
            <span className="lbl">Source dossier · AI-generated, not a score</span>
            <GenerateDossierButton sourceId={source.id} hasDossier={!!source.dossier} />
          </div>
          {source.dossier ? (
            <DossierView dossier={source.dossier} />
          ) : (
            <div
              className="rounded-[var(--radius)] border p-4"
              style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
            >
              <p className="text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
                Generate a profile of this source: its thesis, external facts about the author and
                outlet (each tagged by how it is known), and one analytic caveat. The dossier is
                descriptive; the reliability prior is set separately.
              </p>
            </div>
          )}
        </section>

        {/* reliability prior — set manually, not by the model */}
        <form
          action={setPriorAction}
          className="rounded-[var(--radius)] border p-4 mb-6 flex items-end gap-3"
          style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}
        >
          <input type="hidden" name="source_id" value={source.id} />
          <div className="field flex-1">
            <label htmlFor="reliability_prior">
              Reliability prior (0–100)
            </label>
            <input
              id="reliability_prior"
              name="reliability_prior"
              type="number"
              min={0}
              max={100}
              defaultValue={source.reliability_prior ?? undefined}
              className="input"
              style={{ maxWidth: 140 }}
            />
          </div>
          <button type="submit" className="btn btn--ghost">Save prior</button>
        </form>

        {source.raw_text && (
          <details className="mb-8">
            <summary className="lbl cursor-pointer">Pasted text</summary>
            <div
              className="mt-2 rounded-[var(--radius)] border p-4 max-h-72 overflow-auto"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--dim)' }}>
                {source.raw_text}
              </p>
            </div>
          </details>
        )}

        <section className="mb-8">
          <div className="section-label">Attach evidence</div>
          <EvidenceForm sourceId={source.id} hypotheses={hypotheses} />
        </section>

        {/* Signal Board — turn this source into a tracked signal via the same pipeline steps. */}
        <section className="mb-8">
          <TurnIntoSignalButton sourceId={source.id} />
        </section>

        {/* Research library — independent of the signal path; the same source can go through both. */}
        <section className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 8 }}>
            <span className="lbl">Research · add this source to the research library</span>
          </div>
          <SendToResearchButton sourceId={source.id} />
        </section>

        <section>
          <div className="section-label">Evidence from this source ({evidence.length})</div>
          {evidence.length === 0 ? (
            <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>Nothing attached yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 list-none p-0 m-0">
              {evidence.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-[var(--radius)] border p-3.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <div className="flex items-center flex-wrap gap-2 mb-1 text-xs">
                    <span className={`font-medium ${directionColor(ev.direction)}`}>
                      {directionLabel(ev.direction)}
                    </span>
                    <span style={{ color: 'var(--faint-ink)' }}>· confidence {ev.confidence} ·</span>
                    <Link
                      href={`/hypothesis/${encodeURIComponent(ev.code)}`}
                      style={{ color: 'var(--dim)' }}
                      className="hover:underline"
                    >
                      {ev.code} · {ev.statement}
                    </Link>
                  </div>
                  {ev.excerpt && (
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>{ev.excerpt}</p>
                  )}
                  <div
                    className="flex items-center flex-wrap gap-2 mt-2.5 pt-2.5"
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <form action={reassignEvidenceAction} className="flex items-center flex-wrap gap-2 min-w-0 max-w-full">
                      <input type="hidden" name="evidence_id" value={ev.id} />
                      <input type="hidden" name="source_id" value={source.id} />
                      <select
                        name="hypothesis_id"
                        defaultValue={ev.hypothesis_id}
                        className="input"
                        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                      >
                        {hypotheses.map((h) => (
                          <option key={h.id} value={h.id}>{h.code} · {truncate(h.statement)}</option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn--ghost btn--sm">Reassign</button>
                    </form>
                    <form action={deleteEvidenceAction}>
                      <input type="hidden" name="evidence_id" value={ev.id} />
                      <input type="hidden" name="source_id" value={source.id} />
                      <button type="submit" className="btn btn--quiet btn--sm" style={{ color: 'var(--heat-4)' }}>
                        Detach
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import {
  getPaper, getPaperConcepts, getPaperThreads, getConceptDigest, getThreadDigest,
  getTargets,
} from '@/lib/data';
import { setPaperRigorAction } from '@/lib/actions';
import Header from '@/components/Header';
import PaperAnalysisButton from '@/components/PaperAnalysisButton';
import PaperReviewControls from '@/components/PaperReviewControls';
import PaperLinksPanel, { type SuggestedThreadPlacement } from '@/components/PaperLinksPanel';
import PromotePaperButton from '@/components/PromotePaperButton';
import type { ThreadRelation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Paper · The Strategy Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// The paper page: bibliographic header, the structured FINDING (a claim-shaped
// reading, not a summary), advisory touches, concept/thread links (model proposes,
// human commits), rigor prior (the human's number), and promotion to the Signal
// Board. Public read-only since the lobby redesign; the FINDING went public on
// 2026-08-14 (it is editorial content, like signal briefs). The personal layer
// (review controls, review notes, rigor, promotion, cached full text, the
// model-suggested rigor) stays admin and is never rendered for guests.
export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await isAdmin();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const paper = await getPaper(id);
  if (!paper) notFound();

  const [concepts, threads, conceptDigest, threadDigest, targets] = await Promise.all([
    getPaperConcepts(id), getPaperThreads(id), getConceptDigest(), getThreadDigest(), getTargets(),
  ]);

  const conceptName = new Map(conceptDigest.map((c) => [c.slug, c.name]));
  const threadTitle = new Map(threadDigest.map((t) => [t.slug, t.title]));
  const statementByCode = new Map(targets.hypotheses.map((t) => [t.code, t.statement]));
  const hrefByCode = new Map<string, string>(
    targets.hypotheses.map((t) => [t.code, `/hypothesis/${encodeURIComponent(t.code)}`] as const)
  );

  const confirmedConceptSlugs = new Set(concepts.map((c) => c.slug));
  const suggestedConcepts = paper.suggested_concepts
    .filter((s) => !confirmedConceptSlugs.has(s) && conceptName.has(s))
    .map((s) => ({ slug: s, name: conceptName.get(s)! }));

  const confirmedThreadSlugs = new Set(threads.map((t) => t.slug));
  const placements = paper.extraction?.thread_placements ?? [];
  const placementBySlug = new Map(placements.map((p) => [p.slug, p]));
  const suggestedThreads: SuggestedThreadPlacement[] = paper.suggested_threads
    .filter((s) => !confirmedThreadSlugs.has(s) && threadTitle.has(s))
    .map((s) => ({
      slug: s,
      title: threadTitle.get(s)!,
      relation: (placementBySlug.get(s)?.relation ?? 'context') as ThreadRelation,
      why: placementBySlug.get(s)?.why ?? '',
    }));

  const x = paper.extraction;
  const findingRows: { label: string; value: string }[] = x
    ? [
        { label: 'Headline claim', value: x.headline_claim },
        { label: 'The test', value: x.the_test },
        { label: 'Effect size & scope', value: x.effect_size },
        { label: 'Limitations', value: x.limitations },
        { label: 'Counterpoint', value: x.counterpoint },
        { label: 'Strategy implication', value: x.strategy_implication },
      ].filter((r) => r.value)
    : [];

  return (
    <>
      <Header admin={personal} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <p style={{ marginBottom: 12 }}>
          <Link href="/research" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
            ← Research
          </Link>
        </p>

        <header style={{ marginBottom: 20 }}>
          <h1 style={{ marginBottom: 8 }}>{paper.title}</h1>
          <div className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--faint-ink)' }}>
            <a href={paper.url} target="_blank" rel="noopener noreferrer" className="hover:underline"
              style={{ fontFamily: 'var(--font-mono)' }}>
              {paper.url} ↗
            </a>
            {paper.published_at && <span>· {paper.published_at}</span>}
            {personal && paper.rigor_prior != null && <span>· rigor {paper.rigor_prior}/100</span>}
            {paper.signal_id && (
              <Link href={`/signals/${paper.signal_id}`} className="hover:underline" style={{ color: 'var(--supports)' }}>
                · signal →
              </Link>
            )}
          </div>
          {paper.authors.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 6 }}>
              {paper.authors.slice(0, 12).join(', ')}{paper.authors.length > 12 ? ` +${paper.authors.length - 12}` : ''}
            </p>
          )}
        </header>

        {personal && (
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 8 }}>
            <PaperReviewControls paperId={paper.id} current={paper.review_status} note={paper.review_note} />
          </div>
        )}

        <section style={{ marginTop: 8 }}>
          <div className="section-label">The finding</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
            {personal && <PaperAnalysisButton paperId={paper.id} hasExtraction={!!x} />}
            {!x && !personal && !(paper.triage_summary || paper.triage_reason) && (
              <p className="text-sm" style={{ color: 'var(--faint-ink)', margin: 0 }}>
                No structured finding yet for this paper.
              </p>
            )}
            {!x && (paper.triage_summary || paper.triage_reason) && (
              <div style={{ marginTop: 10 }}>
                {paper.triage_summary && (
                  <p className="text-sm" style={{ color: 'var(--dim)', margin: 0 }}>{paper.triage_summary}</p>
                )}
                {paper.triage_reason && (
                  <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: '4px 0 0' }}>
                    Why it&rsquo;s here: {paper.triage_reason}
                  </p>
                )}
              </div>
            )}
            {findingRows.length > 0 && (
              <div className="flex flex-col gap-3" style={{ marginTop: 16 }}>
                {findingRows.map((r) => (
                  <div key={r.label}>
                    <div className="lbl" style={{ marginBottom: 2 }}>{r.label}</div>
                    <p className="text-sm" style={{ color: 'var(--ink)', margin: 0 }}>{r.value}</p>
                  </div>
                ))}
                {personal && x?.proposed_rigor != null && (
                  <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: 0 }}>
                    Model-suggested rigor: {x.proposed_rigor}/100 (a suggestion only, set the prior below)
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {paper.touches.length > 0 && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">Bears on (advisory · papers never write evidence)</div>
            <div className="flex flex-col gap-1">
              {paper.touches.map((code: string) => {
                const href = hrefByCode.get(code);
                return (
                  <div key={code} className="text-sm rounded-[var(--radius)] border p-2.5"
                    style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                    {href ? (
                      <Link href={href} className="hover:underline" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                        [{code}]
                      </Link>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>[{code}]</span>
                    )}{' '}
                    <span style={{ color: 'var(--dim)' }}>{statementByCode.get(code) ?? 'no longer on the board'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {personal ? (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">Links (model proposes · you commit)</div>
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <PaperLinksPanel
                paperId={paper.id}
                suggestedConcepts={suggestedConcepts}
                confirmedConcepts={concepts.map((c) => ({ slug: c.slug, name: c.name }))}
                suggestedThreads={suggestedThreads}
                confirmedThreads={threads}
                allThreads={threadDigest.map((t) => ({ slug: t.slug, title: t.title }))}
              />
            </div>
          </section>
        ) : (concepts.length > 0 || threads.length > 0) && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">In the Atlas</div>
            <div className="flex flex-col gap-1">
              {threads.map((t) => (
                <Link key={t.slug} href={`/research/threads/${t.slug}`}
                  className="text-sm rounded-[var(--radius)] border p-2.5 hover:underline"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>thread</span>{' '}
                  {t.title}
                </Link>
              ))}
              {concepts.filter((c) => c.name).map((c) => (
                <Link key={c.slug} href={`/concepts/${c.slug}`}
                  className="text-sm rounded-[var(--radius)] border p-2.5 hover:underline"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>concept</span>{' '}
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {personal && (
        <section style={{ marginTop: 8 }}>
          <div className="section-label">Rigor prior · Signal Board</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-4"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
            <form action={setPaperRigorAction} className="flex items-end gap-3 flex-wrap">
              <input type="hidden" name="paper_id" value={paper.id} />
              <div className="field" style={{ maxWidth: 140 }}>
                <label htmlFor="rigor">Rigor prior (0–100)</label>
                <input id="rigor" name="rigor_prior" className="input" type="number" min={0} max={100}
                  defaultValue={paper.rigor_prior ?? ''} />
              </div>
              <button type="submit" className="btn btn--ghost btn--sm">Save</button>
              <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                Your number: methodological trust, never set by the model.
              </span>
            </form>
            <PromotePaperButton paperId={paper.id} />
          </div>
        </section>
        )}

        {paper.abstract && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">Abstract</div>
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)] text-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}>
              {paper.abstract}
              {personal && paper.raw_content && (
                <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10, marginBottom: 0 }}>
                  Full text cached ({Math.round(paper.raw_content.length / 1000)}k chars, via {paper.fetched_via ?? '?'}).
                </p>
              )}
            </div>
          </section>
        )}
      </section>
    </>
  );
}

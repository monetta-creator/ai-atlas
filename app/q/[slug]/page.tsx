import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getQuestion, getQuestionSummaries, getAsOf } from '@/lib/data';
import { LENS_LABEL } from '@/lib/format';
import Header from '@/components/Header';
import StanceCard from '@/components/StanceCard';
import QuestionMap from '@/components/QuestionMap';
import ClaimRow from '@/components/ClaimRow';
import BridgeBand from '@/components/BridgeBand';
import GenerateSummaryButton from '@/components/GenerateSummaryButton';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';
// "Summarize state" runs an Anthropic call (Server Action on this page).
export const maxDuration = 60;

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const [data, asOf] = await Promise.all([getQuestion(slug, personal), getAsOf()]);
  if (!data) notFound();
  const { question, stances, claims, bridges, edges, stanceEvidence } = data;
  const summaryCount = (await getQuestionSummaries(question.id)).length;

  // strongest-opposing stance links (the anti-conspiracy guardrail)
  const opposing: Record<string, string[]> = {};
  const stanceById = Object.fromEntries(stances.map((s) => [s.id, s]));
  for (const e of edges) {
    if (e.from_type === 'stance' && e.to_type === 'stance' && e.relation === 'contradicts') {
      const from = stanceById[e.from_id];
      const to = stanceById[e.to_id];
      if (from && to) {
        (opposing[from.id] ??= []).push(to.code);
        (opposing[to.id] ??= []).push(from.code);
      }
    }
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ paddingBottom: 100 }}>
        <div className="crumbs">
          <Link id="crumb-map" href="/map">Map</Link> / Q{question.sort_order}
          {question.primary_lens ? ` / ${LENS_LABEL[question.primary_lens]}` : ''}
        </div>

        <header className="qhead">
          <div className="qcode">
            Q{question.sort_order}
            {question.primary_lens && <span className="lens">· lens: {LENS_LABEL[question.primary_lens]}</span>}
          </div>
          <h1>{question.title}</h1>
          {question.summary && <p className="lede">{question.summary}</p>}
          <span className="neutral-tag">◇ Neutral question</span>
        </header>

        {(personal || summaryCount > 0) && (
          <div className="flex items-center gap-4 flex-wrap" style={{ margin: '18px 0 4px' }}>
            {personal && <GenerateSummaryButton questionId={question.id} slug={question.slug} />}
            {summaryCount > 0 && (
              <Link href={`/q/${question.slug}/summary`} className="text-xs" style={{ color: 'var(--accent)' }}>
                {personal ? `View state summaries (${summaryCount}) →` : 'View the AI state summary →'}
              </Link>
            )}
          </div>
        )}

        {!personal && <ShareNotice asOf={asOf} />}

        <div className="section-label">Stances · candidate answers</div>
        <div className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3">
          {stances.map((s) => (
            <StanceCard
              key={s.id}
              stance={s}
              admin={personal}
              opposing={opposing[s.id] ?? []}
              evidence={stanceEvidence[s.id]}
            />
          ))}
        </div>

        <div className="section-label">The map: how claims bear on stances</div>
        <div className="map-legend">
          <span className="k sup"><span className="line" /> supports</span>
          <span className="k con"><span className="line" /> contradicts</span>
          <span style={{ marginLeft: 'auto', color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
            hover a node to highlight its links
          </span>
        </div>
        <QuestionMap stances={stances} claims={claims} edges={edges} admin={personal} />

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="section-label" style={{ margin: 0 }}>Claims, each with its falsifiable test</div>
          {personal && (
            <Link href={`/q/${question.slug}/claim/new`} className="btn btn--ghost btn--sm">
              + Add claim
            </Link>
          )}
        </div>
        <div className="claims">
          {claims.map((c) => (
            <ClaimRow key={c.id} claim={c} admin={personal} />
          ))}
        </div>

        <div style={{ marginTop: 8 }} />
        <BridgeBand bridges={bridges} admin={personal} />

        <div className="coordbar">
          <span>
            Q{question.sort_order} / {claims.length} claims / {stances.length} stances / {bridges.length} bridge
            {bridges.length === 1 ? '' : 's'}
          </span>
          <span>·</span>
          <span>confidence moves are made manually; AI proposes only</span>
        </div>
      </section>
    </>
  );
}

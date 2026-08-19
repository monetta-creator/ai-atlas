import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireAdminPage, isPreview } from '@/lib/auth';
import { getQuestionBySlug, getQuestionSummaries, getAsOf } from '@/lib/data';
import { LENS_LABEL } from '@/lib/format';
import Header from '@/components/Header';
import GenerateSummaryButton from '@/components/GenerateSummaryButton';
import QuestionSummaryView from '@/components/QuestionSummaryView';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // hosts the admin-only "Generate summary" action

function fmt(d: string): string {
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function QuestionSummaryHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = await requireAdminPage();
  const preview = await isPreview();
  const personal = admin && !preview;

  const question = await getQuestionBySlug(slug);
  if (!question) notFound();
  const [summaries, asOf] = await Promise.all([getQuestionSummaries(question.id), getAsOf()]);
  const latest = summaries[0];
  const earlier = summaries.slice(1);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / <Link href={`/q/${slug}`}>Q{question.sort_order}</Link> / summaries
        </div>

        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <div className="qcode">
            Q{question.sort_order}
            {question.primary_lens && <span className="lens">· lens: {LENS_LABEL[question.primary_lens]}</span>}
          </div>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 34px)' }}>State summaries</h1>
          <p className="lede" style={{ fontSize: 15, marginTop: 8 }}>{question.title}</p>
        </header>

        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 24 }}>
          {personal && (
            <GenerateSummaryButton questionId={question.id} slug={slug} label="✦ Generate new summary" />
          )}
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            {summaries.length} snapshot{summaries.length === 1 ? '' : 's'} on record
          </span>
        </div>

        {!personal && <ShareNotice asOf={asOf} />}

        {!latest ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
            {personal
              ? 'No summaries yet. Generate one to capture the current state of this question.'
              : 'No summary has been published for this question yet.'}
          </p>
        ) : (
          <>
            <div className="section-label">Latest · {fmt(latest.created_at)}</div>
            <div
              className="rounded-[var(--radius)] border p-[var(--card-pad)]"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 28 }}
            >
              <QuestionSummaryView summary={latest.summary} metrics={latest.metrics} />
            </div>

            {earlier.length > 0 && (
              <>
                <div className="section-label">Earlier snapshots</div>
                <div className="flex flex-col gap-2">
                  {earlier.map((row) => (
                    <details
                      key={row.id}
                      className="rounded-[var(--radius)] border"
                      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                    >
                      <summary className="cursor-pointer px-4 py-3 text-sm" style={{ color: 'var(--dim)' }}>
                        <span style={{ color: 'var(--ink)' }}>{fmt(row.created_at)}</span>
                        {row.summary.headline ? ` · ${row.summary.headline}` : ''}
                      </summary>
                      <div className="px-4 pb-4 pt-1">
                        <QuestionSummaryView summary={row.summary} metrics={row.metrics} />
                      </div>
                    </details>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

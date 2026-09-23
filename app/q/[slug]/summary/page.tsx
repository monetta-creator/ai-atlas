import { notFound } from 'next/navigation';
import { isPreview } from '@/lib/auth';
import { adminGate } from '@/lib/admin-gate';
import { getQuestionBySlug, getQuestionSummaries, getAsOf, getNavCounts } from '@/lib/data';
import { LENS_LABEL } from '@/lib/format';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
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
  const gate = await adminGate(`/q/${slug}/summary`, 'State summaries');
  if (gate) return gate;
  const admin = true as const;
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();

  const question = await getQuestionBySlug(slug);
  if (!question) notFound();
  const [summaries, asOf, counts] = await Promise.all([
    getQuestionSummaries(question.id), getAsOf(), getNavCounts().catch(() => null),
  ]);
  const latest = summaries[0];
  const earlier = summaries.slice(1);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <PageTop
          pathname={`/q/${slug}/summary`}
          label="State summaries"
          viewer={{ admin, portal: admin }}
          counts={counts}
          infoKey="/q/[slug]/summary"
          title={
            <div>
              <div className="qcode">
                Q{question.sort_order}
                {question.primary_lens && <span className="lens">· lens: {LENS_LABEL[question.primary_lens]}</span>}
              </div>
              <Editable
                as="h1"
                k="q-summary.title"
                value={txt('q-summary.title', 'State summaries')}
                editing={editing}
              />
            </div>
          }
        >
          {question.title}
        </PageTop>

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

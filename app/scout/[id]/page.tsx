import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPortal } from '@/lib/auth';
import { getCompany, getCompanyEvents, getScoutVerticals, getCompanyDocuments } from '@/lib/data';
import {
  COMPANY_STAGE_LABEL, COMPANY_STATUS_LABEL, COMPANY_EVENT_LABEL,
  SCOUT_VERDICT_LABEL, scoutVerdictColor, timeAgo,
} from '@/lib/format';
import Header from '@/components/Header';
import CompanyReviewControls from '@/components/scout/CompanyReviewControls';
import CompanyEventForm from '@/components/scout/CompanyEventForm';
import CompanyFactsForm from '@/components/scout/CompanyFactsForm';
import DeleteEventButton from '@/components/scout/DeleteEventButton';
import ResearchPanel from '@/components/scout/ResearchPanel';

export const dynamic = 'force-dynamic';
// Hosts the review/event/facts server actions (and, later, enrichment).
export const maxDuration = 60;

// A company profile. Guests see tracked companies only (the draft-signal rule:
// anything still in the funnel 404s). Portal keyholders additionally see queued
// profiles (their adds await review) and the research panel; the agent's
// verdict and scores, review controls, fact edits, and provenance stay admin.
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await isAdmin();
  const portal = await isPortal();
  const company = await getCompany(id, { admin, portal });
  if (!company) notFound();

  const [events, verticals] = await Promise.all([getCompanyEvents(id), getScoutVerticals()]);
  // Documents are a working-tier surface: admin + portal, never guests.
  const documents = portal ? await getCompanyDocuments(id) : [];
  const vertical = verticals.find((v) => v.slug === company.vertical);
  const scores = company.agent_scores ?? null;
  const dossier = (company.dossier ?? null) as
    | { summary?: string | null; products?: string[]; customers?: string[] }
    | null;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 24 }}>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
            <Link href="/scout" className="hover:underline" style={{ color: 'var(--faint-ink)' }}>Startup Scout</Link>
            {' '}· {vertical?.name ?? company.vertical}
          </p>
          <h1 style={{ marginBottom: 8 }}>{company.name}</h1>
          <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 10 }}>
            {company.one_liner ?? 'No description yet.'}
          </p>
          <div className="flex items-center flex-wrap gap-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
            {company.url && (
              <a href={company.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--accent)' }}>
                {company.domain ?? company.url} ↗
              </a>
            )}
            <span>{COMPANY_STAGE_LABEL[company.stage]}</span>
            {company.founded_year && <span>founded {company.founded_year}</span>}
            {company.hq && <span>{company.hq}</span>}
            {admin && <span>{COMPANY_STATUS_LABEL[company.status]}</span>}
            {!admin && portal && company.status === 'queued' && (
              <span style={{ color: 'var(--heat-2)' }}>In review: awaiting the editor</span>
            )}
          </div>
        </header>

        {company.funding_note && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Funding</div>
            <p className="text-sm" style={{ color: 'var(--dim)' }}>{company.funding_note}</p>
          </section>
        )}

        {company.ai_tech && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">The AI tech</div>
            <p className="text-sm" style={{ color: 'var(--ink)', maxWidth: 640 }}>{company.ai_tech}</p>
          </section>
        )}

        {admin && dossier?.summary && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Dossier · machine-read from the homepage</div>
            <div
              className="rounded-[var(--radius)] border p-3 text-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <p style={{ color: 'var(--dim)' }}>{dossier.summary}</p>
              {(dossier.products?.length || dossier.customers?.length) ? (
                <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
                  {dossier.products?.length ? <span>Products: {dossier.products.join(' · ')}</span> : null}
                  {dossier.customers?.length ? <span>Named customers: {dossier.customers.join(' · ')}</span> : null}
                </div>
              ) : null}
            </div>
          </section>
        )}

        {admin && company.agent_verdict && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Agent read · recommend-only</div>
            <div
              className="rounded-[var(--radius)] border p-3 text-sm"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              <div className="flex items-center flex-wrap gap-2">
                <span style={{ color: scoutVerdictColor(company.agent_verdict), fontWeight: 600 }}>
                  ✦ {SCOUT_VERDICT_LABEL[company.agent_verdict]}
                </span>
                {company.agent_confidence != null && (
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                    {company.agent_confidence}%
                  </span>
                )}
                {company.agent_at && (
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', marginLeft: 'auto' }}>
                    scored {timeAgo(company.agent_at)}
                  </span>
                )}
              </div>
              {company.agent_reason && (
                <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 6 }}>{company.agent_reason}</p>
              )}
              {scores && (
                <div className="flex items-center flex-wrap gap-3 text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', marginTop: 8 }}>
                  <span>AI depth {scores.ai_depth}/5</span>
                  <span>fit {scores.acquisition_fit}/5</span>
                  <span>traction {scores.traction}/5</span>
                  <span>team {scores.team}/5</span>
                  <span>integration {scores.integration_cost}/5</span>
                </div>
              )}
            </div>
          </section>
        )}

        {admin && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Review</div>
            <div
              className="rounded-[var(--radius)] border p-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              {company.review_note && (
                <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 10 }}>
                  <span style={{ color: 'var(--faint-ink)' }}>Why: </span>{company.review_note}
                </p>
              )}
              <CompanyReviewControls
                id={company.id}
                status={company.status}
                prefillNote={company.agent_reason ?? null}
              />
            </div>
          </section>
        )}

        {portal && (
          <section style={{ marginBottom: 22 }}>
            <div className="section-label">Research · steer the AI at this company</div>
            <ResearchPanel id={company.id} isAdmin={admin} hasUrl={!!company.url} documents={documents} />
          </section>
        )}

        <section style={{ marginBottom: 22 }}>
          <div className="section-label">Timeline · {events.length} event{events.length === 1 ? '' : 's'}</div>
          {events.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No events logged yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                    {e.event_date}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--accent)' }}>{COMPANY_EVENT_LABEL[e.kind]}</span>
                  <span style={{ color: 'var(--ink)', flex: 1, minWidth: 200 }}>{e.title}</span>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
                      ↗
                    </a>
                  )}
                  {admin && <DeleteEventButton id={e.id} />}
                  {e.note && (
                    <span className="text-xs" style={{ color: 'var(--dim)', width: '100%' }}>{e.note}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {admin && <CompanyEventForm companyId={company.id} />}
        </section>

        {admin && (
          <>
            <section style={{ marginBottom: 22 }}>
              <div className="section-label">Edit the facts</div>
              <CompanyFactsForm company={company} />
            </section>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
              {company.origin === 'discovery' ? 'found by discovery' : 'added manually'}
              {company.found_url && (
                <>
                  {' · '}
                  <a href={company.found_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    source article ↗
                  </a>
                </>
              )}
              {' · '}added {timeAgo(company.created_at)}
            </p>
          </>
        )}
      </section>
    </>
  );
}

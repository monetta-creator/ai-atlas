import Link from 'next/link';
import Image from 'next/image';
import PageTop from '@/components/PageTop';
import Editable from '@/components/Editable';
import { PORTAL_ICONS, NAV_ICONS } from '@/components/portal-icons';
import { getEditContext } from '@/lib/content';
import { isAdmin, isPortal } from '@/lib/auth';
import { canSee, portalGroups, NAV_TREE } from '@/lib/nav';
import { pageInfoFor } from '@/lib/page-info';
import { DATASETS } from '@/lib/datasets/registry';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Inside the Atlas · The AI Atlas',
  description: 'A tour of every portal in the AI Atlas: what each does, what it looks like, and the pages inside it.',
};

// The tour (2026-09-27): one section per portal, in the rail's order
// (portalGroups, so a new portal appears here without an edit), then Ask and
// Education. Each section: the portal's own summary (lib/page-info, the same
// sentence its "i" dialog opens with), a plain paragraph on what it does, the
// pages inside it the reader can open, and a screen grab where one exists
// (public/showcase, captured by scripts/capture-showcase.mjs).

const GATED = DATASETS.filter((d) => d.keyGated).length;

const PORTAL_DOES: Record<string, string> = {
  signals:
    'A signal is one tracked development: a model release, a deal, a ruling, a study. Each carries a significance level, the audience lenses it matters to (market, labor, geopolitics, regulatory, capability, society), and the claims it bears on, with the direction it pushes. A weekday discovery pipeline drafts most signals from searches across those lenses; a person publishes them, or a 48-hour policy publishes the high-significance drafts that touch a claim unless someone archives them first. Publishing is what writes a signal onto the map as evidence.',
  blotter:
    'The Daily Edition, written each weekday afternoon from what the engines already collected that day, never from a new search: a front page of the biggest AI stories with why each matters and the numbers behind it, a column that ties the day to the open arguments, one-line briefs by desk, the research worth reading, what builders are reading, and every source. It also comes as a two-to-three-page newspaper PDF, and the archive keeps every edition.',
  savant:
    'Savant is the Atlas’s own weekly research report, written every Friday by an autonomous research agent and reviewed by a second model acting as its editor. Each issue leads with one argued analysis, poses one new falsifiable hypothesis and reports what the week did to the open ones, and covers what moved on the map, regulation, research, tools, peers and markets, and what is coming, with figures drawn only from cited records. Anyone can see an issue’s title and contents; reading it needs an access key.',
  map:
    'The argument map itself: the open questions about AI and the economy, the stances people take on each, the falsifiable claims those stances rest on (each with the test that would settle it), the bridge-claims that connect one domain to another, and the evidence for and against. Standing theses are tested against the map and published as reports, and a gap diagnosis proposes the claims the map is missing; a person decides whether to add them.',
  reports:
    'Every report the Atlas writes, as a grid of cover pages: claim and lens tear sheets, the executive briefing, the Friday research roundup, the Daily Edition, Savant, the tooling reports, period reports and thesis reports, plus the weekday company intel deck for access-key holders. Every citation in a report resolves to a record, and every report downloads as a PDF.',
  datasets:
    `The corpus as data: ${DATASETS.length} datasets (${GATED} of them behind an access key), each with a schema page, a query builder that filters, sorts and projects without writing code, CSV and JSON downloads, saved views to share with a team, and a box that turns a plain-language request into a filter. Everything a report cites can be pulled here.`,
  research:
    'New AI research from arXiv, read every weekday against the argument map by a written charter that decides what is worth keeping. The papers that matter are analyzed into a finding, an effect size and its limitations; related papers gather into living threads whose synthesis is rewritten as new work arrives; and a research roundup publishes every Friday.',
  scout:
    'Young AI companies followed as possible acquisition targets: discovered by vertical, profiled with what the company does and the AI underneath it, scored against a rubric by an agent a person reviews, and followed through a running timeline of news and events. Access-key holders can add targets and run a web sweep or read an uploaded document about a company.',
  tooling:
    'A weekly scan of the market for AI tools, written for a transformation team inside a regulated company: tools are discovered by category, enriched with what they do and how they are sold, scored against a rubric, and cataloged when they clear it. Vendor news, deep dives on the strongest entrants, a sortable table, and four kinds of report sit on top, one of them a weekly report on new entrants.',
};

// The screen grabs that exist today (public/showcase, 2880x1800).
const GRABS: Record<string, string> = {
  signals: '/showcase/signals.png',
  blotter: '/showcase/blotter.png',
  map: '/showcase/map.png',
  reports: '/showcase/reports.png',
  datasets: '/showcase/datasets.png',
  research: '/showcase/research.png',
  savant: '/showcase/savant.png',
  scout: '/showcase/scout.png',
  tooling: '/showcase/tooling.png',
};

export default async function InsidePage() {
  const [admin, portal, { editing, txt }] = await Promise.all([isAdmin(), isPortal(), getEditContext()]);
  const viewer = { admin, portal: portal || admin };
  const groups = portalGroups();
  const ask = NAV_TREE.find((g) => g.key === 'ask');
  const education = NAV_TREE.find((g) => g.key === 'education');

  return (
    <>
      <PageTop
        pathname="/about/inside"
        label="Inside the Atlas"
        viewer={viewer}
        title={
          <Editable as="h1" k="about.inside.title" value={txt('about.inside.title', 'Inside the Atlas')} editing={editing} />
        }
      />

      <Editable
        as="p"
        multiline
        k="about.inside.lede"
        value={txt('about.inside.lede', 'Every portal, in the order the navigation lists them: what it is for, what it does, what it looks like, and the pages inside it. Pages marked for access-key holders or the maintainer show only to readers who can open them.')}
        editing={editing}
        style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--dim)', margin: '0 0 28px', maxWidth: '68ch' }}
      />

      <div className="tour">
        {groups.map((g, i) => {
          const pages = g.children.filter((l) => !l.hidden && canSee(l.access, viewer));
          const summary = pageInfoFor(g.href)?.summary ?? '';
          const does = PORTAL_DOES[g.key] ?? '';
          const grab = GRABS[g.key];
          return (
            <section key={g.key} id={g.key} className="tour-sec">
              <div className="tour-text">
                <p className="tour-kicker">{String(i + 1).padStart(2, '0')} · portal</p>
                <h2 className="tour-name">
                  <span className="tour-icon" aria-hidden="true">{PORTAL_ICONS[g.icon] ?? NAV_ICONS[g.icon]}</span>
                  <Link href={g.href}>{g.label}</Link>
                </h2>
                {summary && <p className="tour-summary">{summary}</p>}
                {does && (
                  <Editable as="p" multiline k={`about.inside.sec.${g.key}.body`} value={txt(`about.inside.sec.${g.key}.body`, does)} editing={editing} className="tour-body" />
                )}
                {pages.length > 0 && (
                  <div className="tour-pages">
                    {pages.map((l) => (
                      <Link key={l.href} href={l.href} className="tour-page" data-access={l.access}>{l.label}</Link>
                    ))}
                  </div>
                )}
              </div>
              {grab && (
                <Link href={g.href} className="tour-grab" aria-label={`Open ${g.label}`}>
                  <Image src={grab} alt={`${g.label}, as it looks today`} width={1440} height={900} sizes="(max-width: 900px) 100vw, 520px" loading="lazy" />
                </Link>
              )}
            </section>
          );
        })}

        {ask && (
          <section id="ask" className="tour-sec">
            <div className="tour-text">
              <p className="tour-kicker">Beside the portals</p>
              <h2 className="tour-name">
                <span className="tour-icon" aria-hidden="true">{NAV_ICONS[ask.icon] ?? PORTAL_ICONS[ask.icon]}</span>
                <Link href={ask.href}>{ask.label}</Link>
              </h2>
              <Editable as="p" multiline k="about.inside.sec.ask.body" editing={editing} className="tour-body" value={txt('about.inside.sec.ask.body',
                'Ask answers questions over the whole corpus: the map, the signals, the research, the company intelligence, and the Atlas’s own reports, which it prefers when one already covers the question, citing the records the report rests on. Every citation opens its record, a verification pass flags figures the records do not support, and a marked line separates what the Atlas holds from anything drawn from the web or general knowledge. Asking needs an access key.')} />
            </div>
            <Link href="/ask" className="tour-grab" aria-label="Open Ask">
              <Image src="/showcase/ask.png" alt="Ask, as it looks today" width={1440} height={900} sizes="(max-width: 900px) 100vw, 520px" loading="lazy" />
            </Link>
          </section>
        )}
        {education && (
          <section id="education" className="tour-sec">
            <div className="tour-text">
              <h2 className="tour-name">
                <span className="tour-icon" aria-hidden="true">{NAV_ICONS[education.icon] ?? PORTAL_ICONS[education.icon]}</span>
                <Link href={education.href}>{education.label}</Link>
              </h2>
              <Editable as="p" multiline k="about.inside.sec.education.body" editing={editing} className="tour-body" value={txt('about.inside.sec.education.body',
                'A shelf of guides worth keeping, written once and given a permanent home rather than a feed, each with an optional slide deck.')} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}

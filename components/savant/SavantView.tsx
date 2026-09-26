import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SavedSavantIssue, SavantDepartment, HypothesisReading } from '@/lib/savant/types';
import { SAVANT_STRAPLINE } from '@/lib/savant/types';
import { allowlistForSavant } from '@/lib/savant/allowlist';
import { interleave, type SavantFigure, type FigureSection } from '@/lib/savant/figures-core';
import Figure from './Figure';
import { enforceCitations, type CitationAllowlist } from '@/lib/citations';
import { dateLabel } from '@/lib/format';

// The full issue, for an access-key holder or the admin. Renders one
// SavedSavantIssue with an anchor per SAVANT_TOC key. Every model-written
// HTML fragment is re-gated at render (belt and braces, same discipline as
// EditionView's column): the pack's own allowlist, run through
// enforceCitations again, so a link outside the issue's own evidence can
// never render even if something upstream slipped.

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function GoTo({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (isInternal(href)) return <Link href={href} className={className}>{children}</Link>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function Gated({ html, allow, className }: { html: string | null; allow: CitationAllowlist; className?: string }) {
  const { html: clean } = enforceCitations(html, allow);
  if (!clean) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}

const DIRECTION_LABEL: Record<string, string> = {
  strengthened: 'Strengthened', weakened: 'Weakened', unchanged: 'Unchanged', closed: 'Closed',
};

function DirectionChip({ direction }: { direction: string }) {
  return <span className="sv-direction" data-direction={direction}>{DIRECTION_LABEL[direction] ?? direction}</span>;
}

function HypothesisRow({ r, allow }: { r: HypothesisReading; allow: CitationAllowlist }) {
  return (
    <div className="sv-hypo-row">
      <div className="sv-hypo-head">
        <span className="sv-hypo-statement">{r.statement}</span>
        <DirectionChip direction={r.direction} />
      </div>
      <Gated html={r.html} allow={allow} className="sv-hypo-note" />
      {r.verdict && <p className="sv-hypo-verdict">Verdict: {r.verdict}</p>}
      <p className="sv-hypo-posed">Posed week of {dateLabel(r.posedWeek) ?? r.posedWeek}</p>
    </div>
  );
}

// A section's prose with Savant's figures placed between its blocks (the
// figure leg names the block each one follows). Figure numbers run across
// the whole issue in reading order.
function Illustrated({ html, allow, className, figures, numberOf }: {
  html: string | null; allow: CitationAllowlist; className: string; figures: SavantFigure[]; numberOf: (id: string) => number;
}) {
  if (!figures.length) return <Gated html={html} allow={allow} className={className} />;
  const { html: clean } = enforceCitations(html, allow);
  return (
    <>
      {interleave(clean, figures).map((piece, i) => (
        'figure' in piece
          ? <Figure key={piece.figure.id} figure={piece.figure} index={numberOf(piece.figure.id)} />
          : <div key={i} className={className} dangerouslySetInnerHTML={{ __html: piece.html }} />
      ))}
    </>
  );
}

function DepartmentSection({ d, allow, figures, numberOf }: { d: SavantDepartment; allow: CitationAllowlist; figures: SavantFigure[]; numberOf: (id: string) => number }) {
  return (
    <section className="sv-section" id={d.key}>
      <h2 className="sv-h2">{d.title}</h2>
      <Illustrated html={d.html} allow={allow} className="sv-prose" figures={figures} numberOf={numberOf} />
    </section>
  );
}

// ---------------------------------------------------------------- Appendix B: sources

function collectHrefs(html: string | null): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<a\s+[^>]*href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function hostOf(href: string): string {
  if (isInternal(href)) return 'The AI Atlas (in-app record)';
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

export default function SavantView({ saved }: { saved: SavedSavantIssue }) {
  const { pack, narrative } = saved;
  const allow = allowlistForSavant(pack);
  const summaryGated = narrative.summary.map((html) => enforceCitations(html, allow).html).filter((h): h is string => !!h);
  const figures = narrative.figures ?? [];
  const sectionOrder: FigureSection[] = ['lead', ...narrative.departments.map((d) => d.key)];
  const numbered = [...figures].sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section) || a.after - b.after);
  const figureNumber = (id: string) => numbered.findIndex((f) => f.id === id) + 1;
  const figuresFor = (section: FigureSection) => figures.filter((f) => f.section === section);

  const gatedFragments = [
    ...narrative.summary,
    narrative.lead.html,
    narrative.hypotheses.fresh?.html ?? null,
    ...narrative.hypotheses.readings.map((r) => r.html),
    ...narrative.departments.map((d) => d.html),
  ];
  const hostGroups = new Map<string, Set<string>>();
  for (const frag of gatedFragments) {
    const { html: clean } = enforceCitations(frag, allow);
    for (const href of collectHrefs(clean)) {
      const host = hostOf(href);
      if (!hostGroups.has(host)) hostGroups.set(host, new Set());
      hostGroups.get(host)!.add(href);
    }
  }

  return (
    <div className="sv-wrap">
      <div className="sv-masthead" id="masthead">
        <div>
          <p className="sv-wordmark">THE AI ATLAS</p>
          <p className="sv-signature">Savant</p>
        </div>
        <div className="sv-mast-right">
          <p className="sv-issueline">Issue No. {pack.issueNumber} · Week ending {dateLabel(pack.weekEnd)}</p>
        </div>
      </div>
      <p className="sv-strapline">{SAVANT_STRAPLINE}</p>
      <div className="sv-rule" />

      <section className="sv-section" id="summary">
        <h2 className="sv-h2">Executive summary</h2>
        <ol className="sv-summary">
          {summaryGated.map((html, i) => <li key={i} dangerouslySetInnerHTML={{ __html: html }} />)}
        </ol>
      </section>

      <section className="sv-section" id="lead">
        <p className="sv-byline">by Savant</p>
        <h2 className="sv-lead-title">{narrative.lead.title}</h2>
        <Illustrated html={narrative.lead.html} allow={allow} className="sv-prose sv-lead-prose" figures={figuresFor('lead')} numberOf={figureNumber} />
        <p className="sv-wordcount">{narrative.lead.wordCount} words</p>
      </section>

      <section className="sv-section" id="hypotheses">
        <h2 className="sv-h2">Savant&rsquo;s hypotheses</h2>
        {narrative.hypotheses.fresh && (
          <div className="sv-hypo-new">
            <p className="sv-hypo-newlabel">New this week</p>
            <p className="sv-hypo-statement">{narrative.hypotheses.fresh.statement}</p>
            <Gated html={narrative.hypotheses.fresh.html} allow={allow} className="sv-hypo-note" />
          </div>
        )}
        {narrative.hypotheses.readings.map((r) => <HypothesisRow key={r.id} r={r} allow={allow} />)}
        {!narrative.hypotheses.fresh && narrative.hypotheses.readings.length === 0 && (
          <p className="sv-empty">No hypothesis this week.</p>
        )}
      </section>

      {narrative.departments.map((d) => <DepartmentSection key={d.key} d={d} allow={allow} figures={figuresFor(d.key)} numberOf={figureNumber} />)}

      <section className="sv-section" id="appendix-a">
        <h2 className="sv-h2">Appendix A: how this issue was researched</h2>
        {pack.plan && (
          <div className="sv-plan">
            <p className="sv-plan-topic">{pack.plan.topic}</p>
            <p className="sv-plan-why">{pack.plan.why}</p>
            <p className="sv-plan-hypo">Hypothesis: {pack.plan.hypothesis.statement}</p>
            {pack.plan.hypothesis.what_would_settle_it.length > 0 && (
              <>
                <p className="sv-plan-sub">What would settle it</p>
                <ul>{pack.plan.hypothesis.what_would_settle_it.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </>
            )}
            {pack.plan.hypothesis.watch.length > 0 && (
              <>
                <p className="sv-plan-sub">Watch</p>
                <ul>{pack.plan.hypothesis.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </>
            )}
          </div>
        )}
        {pack.notebook.notes.length > 0 && (
          <div className="sv-notes">
            <p className="sv-plan-sub">Notes by day</p>
            {pack.notebook.notes.map((n) => (
              <div key={n.day} className="sv-note-row">
                <span className="sv-note-day">{dateLabel(n.day) ?? n.day}</span>
                <span className="sv-note-text">{n.text}</span>
              </div>
            ))}
          </div>
        )}
        {narrative.research.queries.length > 0 && (
          <table className="sv-query-table">
            <thead><tr><th>Round</th><th>Tool</th><th>Query</th><th>Results</th></tr></thead>
            <tbody>
              {narrative.research.queries.map((q, i) => (
                <tr key={i}><td>{q.round}</td><td>{q.tool}</td><td>{q.query}</td><td>{q.results}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {narrative.editor && narrative.editor.cuts.length > 0 && (
          <div className="sv-cuts">
            <p className="sv-plan-sub">The editor&rsquo;s cuts</p>
            {narrative.editor.cuts.map((c, i) => (
              <p key={i} className="sv-cut-row"><span className="sv-cut-section">{c.section}:</span> &ldquo;{c.quote}&rdquo; ({c.reason})</p>
            ))}
          </div>
        )}
        {narrative.dropped.length > 0 && (
          <div className="sv-dropped">
            <p className="sv-plan-sub">Removed by the citation gate</p>
            <ul>{narrative.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="sv-section" id="appendix-b">
        <h2 className="sv-h2">Appendix B: sources</h2>
        {[...hostGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, hrefs]) => (
          <div key={host} className="sv-source-group">
            <p className="sv-source-host">{host}</p>
            <ul>
              {[...hrefs].map((href) => (
                <li key={href}><GoTo href={href}>{allow.tagByHref.get(href) ?? href}</GoTo></li>
              ))}
            </ul>
          </div>
        ))}
        <p className="sv-attest">
          Every link above resolves to a public record or a stored Atlas record. Savant reads no private data.
        </p>
      </section>

      {narrative.editor && (
        <section className="sv-section" id="editor">
          <h2 className="sv-h2">Editor&rsquo;s note</h2>
          <p className="sv-editor-verdict" data-verdict={narrative.editor.verdict}>{narrative.editor.verdict.replace(/_/g, ' ')}</p>
          <p className="sv-editor-note">{narrative.editor.note}</p>
          <p className="sv-editor-sig">Signed, {narrative.editor.name}</p>
        </section>
      )}

      <p className="sv-colophon">
        Issue No. {pack.issueNumber} · researched {dateLabel(pack.windowFrom)}&ndash;{dateLabel(pack.windowTo)} · written by
        Savant ({narrative.models.writer}) · reviewed by {narrative.editor?.name ?? 'the editor'} ({narrative.models.editor}) ·
        Produced by The AI Atlas.
      </p>
    </div>
  );
}

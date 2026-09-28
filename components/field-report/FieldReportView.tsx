import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { SavedFieldReport } from '@/lib/data/field-reports';
import { researchDigest, sourceTitles, type RenderedBlock, type RenderedSection, type Provenance } from '@/lib/field-report/core';
import { contourLines } from '@/lib/field-report/contour';
import { allowlistForFieldReport } from '@/lib/field-report/allowlist';
import { enforceCitations, type CitationAllowlist } from '@/lib/citations';
import type { SavantFigure } from '@/lib/savant/figures-core';
import { collectCitedSources } from '@/lib/savant/sources-core';
import Figure from '@/components/savant/Figure';
import { dateLabel } from '@/lib/format';
import FieldReportActions from './FieldReportActions';

// The Field Report read view: a paper-white header carrying the topographic
// contour motif and a deep-green accent (a different mark from Savant's
// cobalt cover, on purpose: Field Report is its own imprint), the question
// as the headline, a contents list built from the plan's sub-questions
// (each paired by position with the section the writer built for it), the
// provenance bar, the summary, every section with a provenance chip per
// paragraph, figures (when the run planned any), the editor's note (Full
// runs only), and two appendices. Every rendered fragment is re-gated with
// enforceCitations at render time, belt and braces with the engine's own
// gate at save time, the same discipline SavantView applies.

const PROV_LABEL: Record<Provenance, string> = { atlas: 'Atlas', web: 'Web', mixed: 'Mixed', analysis: 'Analysis' };

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function GoTo({ href, children }: { href: string; children: ReactNode }) {
  if (isInternal(href)) return <Link href={href}>{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function ProvChip({ prov }: { prov: Provenance }) {
  return <span className="frv-chip" data-prov={prov}>{PROV_LABEL[prov]}</span>;
}

function Block({ block, allow }: { block: RenderedBlock; allow: CitationAllowlist }) {
  const { html: clean } = enforceCitations(block.html, allow);
  if (!clean) return null;
  const Tag = block.kind === 'h3' ? 'h3' : block.kind === 'quote' ? 'blockquote' : 'div';
  return (
    <div className="frv-block" data-kind={block.kind} data-prov={block.prov}>
      <ProvChip prov={block.prov} />
      <Tag className="frv-block-body" dangerouslySetInnerHTML={{ __html: clean }} />
    </div>
  );
}

// Every block keeps its own provenance chip; a figure follows the block its
// `after` names (the figure leg numbers each section's blocks), or closes the
// section when `after` is -1 or past the end.
function Blocks({ blocks, allow, figures, numberOf }: { blocks: RenderedBlock[]; allow: CitationAllowlist; figures: SavantFigure[]; numberOf: (id: string) => number }) {
  const at = (f: SavantFigure) => (f.after < 0 || f.after >= blocks.length ? blocks.length - 1 : f.after);
  return (
    <>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          <Block block={b} allow={allow} />
          {figures.filter((f) => at(f) === i).map((f) => <Figure key={f.id} figure={f} index={numberOf(f.id)} />)}
        </Fragment>
      ))}
      {!blocks.length && figures.map((f) => <Figure key={f.id} figure={f} index={numberOf(f.id)} />)}
    </>
  );
}

function ProvenanceBar({ share }: { share: SavedFieldReport['pack']['provenance'] }) {
  const total = share.atlas + share.web + share.mixed + share.analysis;
  if (!total) return null;
  const kinds: Provenance[] = ['atlas', 'web', 'mixed', 'analysis'];
  return (
    <div className="frv-provbar-wrap">
      <div className="frv-provbar" role="img" aria-label="Where this report's paragraphs come from">
        {kinds.map((k) => share[k] > 0 && (
          <span key={k} className="frv-provbar-seg" data-prov={k} style={{ width: `${(share[k] / total) * 100}%` }} />
        ))}
      </div>
      <div className="frv-provlegend">
        {kinds.map((k) => (
          <span key={k} className="frv-provlegend-item">
            <i data-prov={k} /> {PROV_LABEL[k]} <span className="frv-provlegend-n">{share[k]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({ section, allow, figures, numberOf }: { section: RenderedSection; allow: CitationAllowlist; figures: SavantFigure[]; numberOf: (id: string) => number }) {
  return (
    <section className="frv-section" id={section.key}>
      <h2 className="frv-h2">{section.title}</h2>
      <Blocks blocks={section.blocks} allow={allow} figures={figures} numberOf={numberOf} />
    </section>
  );
}

export default function FieldReportView({ saved, admin }: { saved: SavedFieldReport; admin: boolean }) {
  const { pack, narrative } = saved;
  const allow = allowlistForFieldReport(pack);
  const contours = contourLines(saved.id);
  const dateStr = dateLabel(pack.generatedAt.slice(0, 10)) ?? pack.generatedAt.slice(0, 10);

  // Figures ride alongside a section by matching `section` keys (the run's
  // figures leg mirrors Savant's figure core with the section list made a
  // parameter, so the shape is structurally SavantFigure even though the
  // section keys are this report's own slugs, not Savant's fixed union).
  const figures = (narrative.figures ?? []) as unknown as SavantFigure[];
  const sectionOrder = narrative.sections.map((s) => s.key);
  const orderedFigures = [...figures].sort(
    (a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section) || a.after - b.after
  );
  const figureNumber = (id: string) => orderedFigures.findIndex((f) => f.id === id) + 1;
  const figuresFor = (key: string) => figures.filter((f) => f.section === key);

  // Contents: the plan's own sub-questions, paired by position with the
  // section the writer built for each one (one section per sub-question, in
  // plan order); any trailing sections the writer added on its own (new
  // considerations, where the evidence disagrees, and so on) still render in
  // the body below, just outside this contents list.
  const contentsN = Math.min(pack.plan.sub_questions.length, narrative.sections.length);
  const contents = Array.from({ length: contentsN }, (_, i) => ({
    label: pack.plan.sub_questions[i],
    key: narrative.sections[i].key,
  }));

  const titles = sourceTitles(pack.records, pack.web);
  const cited = collectCitedSources(narrative, allow.hrefs).map((src) =>
    titles.has(src.href) ? { ...src, label: titles.get(src.href)! } : src
  );
  const digest = researchDigest(pack.research.log, pack.plan.sub_questions);

  return (
    <div className="frv-wrap">
      <div className="frv-cover" id="masthead">
        <svg className="frv-contour" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {contours.map((line) => (
            <path key={line.ring} d={line.d} fill="none" stroke="#1f6f4a" strokeWidth={1.2} strokeOpacity={0.12 + line.ring * 0.04} />
          ))}
        </svg>
        <div className="frv-cover-body">
          <p className="frv-wordmark">THE AI ATLAS</p>
          <p className="frv-kicker">
            FIELD REPORT &middot; {pack.size.toUpperCase()} &middot; {dateStr}
          </p>
          <h1 className="frv-headline">{pack.question}</h1>
          <p className="frv-objective">{pack.plan.objective}</p>
          <FieldReportActions id={saved.id} isPublished={saved.is_published} admin={admin} />
        </div>
      </div>

      {contents.length > 0 && (
        <div className="frv-toc">
          <p className="frv-toc-head">In this report</p>
          <ol>
            {contents.map((c) => (
              <li key={c.key}><a href={`#${c.key}`}>{c.label}</a></li>
            ))}
          </ol>
        </div>
      )}

      <ProvenanceBar share={pack.provenance} />

      {narrative.summary.length > 0 && (
        <section className="frv-section" id="summary">
          <h2 className="frv-h2">Summary</h2>
          {narrative.summary.map((b, i) => <Block key={i} block={b} allow={allow} />)}
        </section>
      )}

      {narrative.sections.map((s) => (
        <Section key={s.key} section={s} allow={allow} figures={figuresFor(s.key)} numberOf={figureNumber} />
      ))}

      {narrative.editor && (
        <section className="frv-section frv-editor" id="editor">
          <h2 className="frv-h2">Editor&rsquo;s note</h2>
          <p className="frv-editor-verdict" data-verdict={narrative.editor.verdict}>{narrative.editor.verdict.replace(/_/g, ' ')}</p>
          <p className="frv-editor-note">{narrative.editor.note}</p>
          <p className="frv-editor-sig">Signed, {narrative.editor.name}</p>
        </section>
      )}

      <section className="frv-section" id="appendix-a">
        <h2 className="frv-h2">Appendix A: how this report was researched</h2>
        <p className="frv-appendix-stat">
          {pack.research.rounds} research round{pack.research.rounds === 1 ? '' : 's'} &middot; {pack.research.webSearches} web search{pack.research.webSearches === 1 ? '' : 'es'}
        </p>
        {digest.length > 0 && (
          <ul className="frv-digest">
            {digest.map((d) => (
              <li key={d.label}>
                <p className="frv-digest-q">{d.label}</p>
                <p className="frv-digest-n">
                  {d.searches} search{d.searches === 1 ? '' : 'es'}{d.reads ? ` · ${d.reads} record${d.reads === 1 ? '' : 's'} read` : ''}
                </p>
                {d.queries.length > 0 && <p className="frv-digest-queries">{d.queries.join(' · ')}</p>}
              </li>
            ))}
          </ul>
        )}
        {pack.research.log.length > 0 && (
          <details className="frv-log">
            <summary>Every step ({pack.research.log.length})</summary>
            <table className="frv-table">
              <thead><tr><th>Round</th><th>Track</th><th>Tool</th><th>Query</th><th>Results</th></tr></thead>
              <tbody>
                {pack.research.log.map((r, i) => (
                  <tr key={i}><td>{r.round}</td><td>{r.track}</td><td>{r.tool}</td><td>{r.query}</td><td>{r.tool === 'web_search' ? '' : r.results}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {pack.research.dropped.length > 0 && (
          <div className="frv-dropped">
            <p className="frv-sub">Removed by the citation gate</p>
            <ul>{pack.research.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="frv-section" id="appendix-b">
        <h2 className="frv-h2">Appendix B: sources</h2>
        {cited.length === 0 ? (
          <p className="frv-empty">No cited sources.</p>
        ) : (
          <ul className="frv-sources">
            {cited.map((src) => (
              <li key={src.href}>
                <GoTo href={src.href}>{src.label}</GoTo>
                <span className="frv-source-host"> &middot; {src.host}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="frv-colophon">
        Researched by {pack.models.research} &middot; written by {pack.models.writer}
        {narrative.editor ? ` · reviewed by ${narrative.editor.name} (${pack.models.editor})` : ''} &middot; Produced by The AI Atlas.
      </p>
    </div>
  );
}

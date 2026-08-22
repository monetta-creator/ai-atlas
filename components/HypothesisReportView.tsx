import Link from 'next/link';
import { dateLabel } from '@/lib/format';
import type { SavedHypothesisReport } from '@/lib/types';
import HypothesisStatsView from './HypothesisStatsView';

// Public, read-only render of a saved hypothesis report. Server component, no
// client JS. The narrative HTML is re-gated against the frozen pack at the page
// boundary before it reaches this component; the pack is guest-safe by construction.

const DIRECTION_WORD: Record<string, string> = {
  supports: 'supporting',
  contradicts: 'contradicting',
  neutral: 'neutral',
};

function Prose({ html }: { html: string }) {
  return <div className="report-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function HypothesisReportView({ report }: { report: SavedHypothesisReport }) {
  const { pack, narrative } = report;
  const when = dateLabel(report.generated_at) ?? report.generated_at.slice(0, 10);

  return (
    <article className="flex flex-col gap-2">
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontFamily: 'var(--font-headline)', fontWeight: 400, fontSize: 'clamp(30px,5vw,46px)', margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1.05, letterSpacing: '0.005em' }}>
          {report.title}
        </h1>
        <p style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--dim)' }}>
          Hypothesis {pack.code}: <span style={{ color: 'var(--ink)' }}>{report.statement}</span>
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--faint-ink)' }}>
          Strategy Atlas hypothesis report · generated {when} · grounded only in the Atlas&apos;s tracked signals
        </p>
        <p style={{ margin: '14px 0 0' }}>
          <a href={`/hypothesis-report/${report.id}/pdf`} className="btn btn--primary btn--sm">
            Download the PDF
          </a>
        </p>
      </header>

      <section>
        <div className="section-label">Evidence at a glance</div>
        <HypothesisStatsView stats={pack.stats} delta={pack.delta} />
      </section>

      {pack.test && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">Falsified if</div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)', lineHeight: 1.6 }}>{pack.test}</p>
        </section>
      )}

      {narrative.reading && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">What the signals show</div>
          <Prose html={narrative.reading} />
        </section>
      )}

      {narrative.counterweight && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">The other read and what is missing</div>
          <Prose html={narrative.counterweight} />
        </section>
      )}

      {narrative.bottomLine && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">Bottom line</div>
          <Prose html={narrative.bottomLine} />
        </section>
      )}

      {!narrative.reading && !narrative.counterweight && !narrative.bottomLine && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--faint-ink)' }}>
          This run was saved as an evidence pack only: the statistics and signal list above are the
          report, with no AI narrative.
        </p>
      )}

      <section style={{ marginTop: 22 }}>
        <div className="section-label">Matched signals ({pack.signals.length})</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--dim)', fontSize: 13, lineHeight: 1.7 }}>
          {pack.signals.map((s) => (
            <li key={s.id}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{s.tag}</span>{' '}
              <Link href={`/signals/${s.id}`} style={{ color: 'var(--ink)' }}>{s.title}</Link>
              {' · '}{s.published_at ?? 'undated'} · {s.significance}
              {' · '}{s.direction ? (DIRECTION_WORD[s.direction] ?? s.direction) : 'no direction'}
              {s.source_domain ? ` · ${s.source_domain}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ margin: '18px 0 0', fontSize: 12, color: 'var(--faint-ink)', lineHeight: 1.6 }}>
        Orientation, not proof. Every statistic in this report is computed directly from the Atlas&apos;s
        signal corpus; the narrative, where present, is AI-written over that frozen evidence only, and
        every link is checked against it. Coverage limits are stated above; absence of evidence here is
        not evidence of absence.
      </p>
    </article>
  );
}

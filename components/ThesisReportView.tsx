import Link from 'next/link';
import { dateLabel } from '@/lib/format';
import type { SavedThesisReport } from '@/lib/types';
import ThesisStatsView from './ThesisStatsView';

// Public, read-only render of a saved thesis report. Server component, no client
// JS. The narrative HTML is re-gated against the frozen pack at the page boundary
// before it reaches this component, and the pack is guest-safe by construction.

const STANCE_WORD: Record<string, string> = {
  supports: 'supporting',
  contradicts: 'contradicting',
  mixed: 'mixed',
  neutral: 'neutral',
  untyped: 'no direction',
};

function Prose({ html }: { html: string }) {
  return <div className="report-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ThesisReportView({ report }: { report: SavedThesisReport }) {
  const { pack, narrative } = report;
  const when = dateLabel(report.generated_at) ?? report.generated_at.slice(0, 10);

  return (
    <article className="flex flex-col gap-2">
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontFamily: 'var(--font-headline)', fontWeight: 400, fontSize: 'clamp(30px,5vw,46px)', margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1.05, letterSpacing: '0.005em' }}>
          {report.title}
        </h1>
        <p style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--dim)' }}>
          Thesis: <span style={{ color: 'var(--ink)' }}>{report.statement}</span>
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--faint-ink)' }}>
          AI Atlas thesis report · generated {when} · grounded only in the Atlas&apos;s tracked signals
        </p>
        <p style={{ margin: '14px 0 0' }}>
          <a href={`/thesis-report/${report.id}/pdf`} className="btn btn--primary btn--sm">
            Download the PDF
          </a>
        </p>
      </header>

      <section>
        <div className="section-label">Evidence at a glance</div>
        <ThesisStatsView stats={pack.stats} delta={pack.delta} />
      </section>

      {pack.claims.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <div className="section-label">Mapped claims</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--dim)', fontSize: 14, lineHeight: 1.6 }}>
            {pack.claims.map((c) => (
              <li key={c.code} style={{ margin: '3px 0' }}>
                <Link href={c.href} style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{c.code}</Link>
                {' · '}<span style={{ color: 'var(--ink)' }}>{c.statement}</span>{' '}
                ({c.signal_count} signal{c.signal_count === 1 ? '' : 's'})
              </li>
            ))}
          </ul>
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
              {' · '}{STANCE_WORD[s.stance] ?? s.stance}
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

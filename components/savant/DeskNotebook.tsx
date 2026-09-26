import Link from 'next/link';
import { weekdaysOf } from '@/lib/savant/week';
import { dateLabel } from '@/lib/format';
import type {
  NotebookRow, NotebookKind, NotebookRecordRef, PlanPayload, NotePayload,
  ConnectionPayload, EchoPayload, AnomalyPayload, MissPayload,
} from '@/lib/savant/types';

// This week's notebook: a week picker over the last 12 weeks (plus the
// live current week, which may still have zero rows), then the selected
// week's rows grouped by weekday and, within a day, by kind in the fixed
// reading order below rather than the DB's day/kind/created_at order.
const KIND_ORDER: NotebookKind[] = ['plan', 'note', 'connection', 'echo', 'anomaly', 'miss', 'query', 'editor'];

const KIND_LABEL: Record<NotebookKind, string> = {
  plan: 'Plan', note: 'Note', connection: 'Connection', echo: 'Echo',
  anomaly: 'Anomaly', miss: 'Miss', query: 'Query', editor: 'Editor',
};

function weekdayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
}

function recordLink(record: NotebookRecordRef) {
  if (record.href) return <Link href={record.href}>{record.title}</Link>;
  if (record.url) return <a href={record.url} target="_blank" rel="noopener noreferrer">{record.title}</a>;
  return <span>{record.title}</span>;
}

function renderRow(row: NotebookRow) {
  switch (row.kind) {
    case 'plan': {
      const p = row.payload as PlanPayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="plan">{KIND_LABEL.plan}</span>
          <strong>{p.topic}</strong>{' '}
          <Link href={`/q/${p.question_slug}`} className="sv-chip">{p.question_slug}</Link>
          {p.fallback && <span className="sv-chip" title="the deterministic plan stood in for the model">fallback</span>}
          <p>{p.why}</p>
          <p><em>{p.hypothesis.statement}</em></p>
          {p.hypothesis.what_would_settle_it.length > 0 && (
            <ul>
              {p.hypothesis.what_would_settle_it.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          {p.hypothesis.watch.map((w, i) => <span className="sv-chip" key={i}>{w}</span>)}
        </div>
      );
    }
    case 'note': {
      const p = row.payload as NotePayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="note">{KIND_LABEL.note}</span>
          {p.text}
        </div>
      );
    }
    case 'connection': {
      const p = row.payload as ConnectionPayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="connection">{KIND_LABEL.connection}</span>
          {recordLink(p.record)} {'→'} <Link href={p.target.href}>{p.target.code}</Link> {p.target.statement}
          <span className="sv-sim"> · sim {p.sim.toFixed(2)}</span>
        </div>
      );
    }
    case 'echo': {
      const p = row.payload as EchoPayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="echo">{KIND_LABEL.echo}</span>
          {recordLink(p.a)} {'↔'} {recordLink(p.b)}
          <span className="sv-sim"> · sim {p.sim.toFixed(2)}</span>
        </div>
      );
    }
    case 'anomaly': {
      const p = row.payload as AnomalyPayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="anomaly">{KIND_LABEL.anomaly}</span>
          {p.note}
          {(p.z !== undefined || p.source) && (
            <span className="sv-chip">
              {p.z !== undefined ? `z ${p.z.toFixed(1)}` : ''}
              {p.z !== undefined && p.source ? ' · ' : ''}
              {p.source ?? ''}
            </span>
          )}
        </div>
      );
    }
    case 'miss': {
      const p = row.payload as MissPayload;
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind="miss">{KIND_LABEL.miss}</span>
          {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.headline}</a> : p.headline}
          {' '}{p.detail}
        </div>
      );
    }
    case 'query':
    case 'editor': {
      const payload = row.payload as Record<string, unknown> | null;
      const summary = payload && typeof payload.summary === 'string' ? payload.summary : JSON.stringify(payload);
      return (
        <div className="sv-row" key={row.id}>
          <span className="sv-kind" data-kind={row.kind}>{KIND_LABEL[row.kind]}</span>
          <span className="sv-sim">{clip(summary, 200)}</span>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function DeskNotebook({
  weekEnd, currentWeek, weeks, rows,
}: {
  weekEnd: string;
  currentWeek: string;
  weeks: { week_end: string; rows: number; days: number }[];
  rows: NotebookRow[];
}) {
  const weekEnds = Array.from(new Set([currentWeek, ...weeks.map((w) => w.week_end)])).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div>
      <nav className="sv-weekpick" aria-label="Notebook week">
        {weekEnds.map((we) => (
          <Link key={we} href={`/savant/desk?week=${we}`} data-active={we === weekEnd ? '' : undefined}>
            {dateLabel(we) ?? we}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="sv-empty">Nothing in the notebook yet for this week. The weekday pass writes it at 17:15 UTC.</p>
      ) : (
        weekdaysOf(weekEnd).map((day) => {
          const dayRows = rows.filter((r) => r.day === day);
          if (dayRows.length === 0) return null;
          return (
            <div className="sv-day" key={day}>
              <h3 className="sv-day-head">{weekdayLabel(day)}</h3>
              {KIND_ORDER.flatMap((kind) => dayRows.filter((r) => r.kind === kind).map(renderRow))}
            </div>
          );
        })
      )}
    </div>
  );
}

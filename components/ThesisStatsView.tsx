import { SIGNAL_LENS_LABEL, signalLensColor } from '@/lib/format';
import type { ThesisDelta, ThesisStats } from '@/lib/types';

// Presentational render of a thesis pack's computed stats (and, when present, the
// since-last-run delta). Pure server-side markup, no client JS; used by both the
// admin console preview and the public report view, so it must stay guest-safe
// (it only ever receives the guest-safe pack fields).

const STANCE_META: { key: keyof ThesisStats['stances']; label: string; color: string }[] = [
  { key: 'supports', label: 'Supporting', color: 'var(--color-supports)' },
  { key: 'contradicts', label: 'Contradicting', color: 'var(--color-contradicts)' },
  { key: 'mixed', label: 'Mixed', color: 'var(--heat-2)' },
  { key: 'neutral', label: 'Neutral', color: 'var(--color-depends)' },
  { key: 'untyped', label: 'No direction', color: 'var(--faint-ink)' },
];

const tile: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
  padding: '10px 12px',
  minWidth: 0,
};

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint-ink)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  );
}

export default function ThesisStatsView({ stats, delta }: { stats: ThesisStats; delta: ThesisDelta | null }) {
  const s = stats;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        <Tile label="Matched" value={`${s.matched} / ${s.scanned}`} />
        {STANCE_META.map((m) => (
          <Tile key={m.key} label={m.label} value={String(s.stances[m.key])} color={m.color} />
        ))}
        <Tile label="High significance" value={String(s.significance.high)} />
      </div>

      {(s.oneSided || s.thin) && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--heat-4)' }}>
          {s.oneSided && 'One-sided evidence: no contradicting signal in the corpus. '}
          {s.thin && 'Thin coverage: fewer than 5 matched signals.'}
        </p>
      )}

      <p style={{ margin: 0, fontSize: 13, color: 'var(--dim)', lineHeight: 1.55 }}>{s.corpusNote}</p>

      {s.lenses.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ fontSize: 12 }}>
          {s.lenses.map((l) => (
            <span
              key={l.lens}
              style={{
                color: signalLensColor(l.lens),
                border: '1px solid var(--line)',
                borderRadius: 999,
                padding: '2px 10px',
              }}
            >
              {SIGNAL_LENS_LABEL[l.lens]} · {l.n}
            </span>
          ))}
        </div>
      )}

      {s.recency.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ fontSize: 12, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          {s.recency.map((r) => (
            <span key={r.bucket}>
              {r.bucket} · <span style={{ color: r.n ? 'var(--ink)' : 'var(--faint-ink)' }}>{r.n}</span>
            </span>
          ))}
        </div>
      )}

      {s.domains.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--faint-ink)' }}>
          Sources:{' '}
          {s.domains
            .map((d) => `${d.domain} (${d.n}${d.seen ? `, pipeline ${d.approved}/${d.seen} approved` : ''})`)
            .join(' · ')}
        </div>
      )}

      {delta && (
        <div
          style={{
            border: '1px solid var(--line)',
            borderLeft: '3px solid var(--accent)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--dim)',
          }}
        >
          <strong style={{ color: 'var(--ink)' }}>Since the last run</strong>{' '}
          ({delta.prev_generated_at.slice(0, 10)}):{' '}
          {delta.new_signal_tags.length === 0
            ? 'no new matching signals'
            : `${delta.new_signal_tags.length} new signal${delta.new_signal_tags.length === 1 ? '' : 's'} (${delta.new_signal_tags.join(', ')})`}
          {delta.removed_count > 0 && `, ${delta.removed_count} no longer match`}
          {delta.new_signal_tags.length > 0 && (
            <>
              {' · new stances: '}
              {delta.new_stances.supports} supporting, {delta.new_stances.contradicts} contradicting,{' '}
              {delta.new_stances.mixed} mixed, {delta.new_stances.neutral} neutral, {delta.new_stances.untyped} without direction
            </>
          )}
        </div>
      )}
    </div>
  );
}

import type { SignalBrief, SignalCounterpoint } from '@/lib/types';

// Presentational. Renders the cached AI analysis a signal carries: the deep-dive briefing
// and the counterpoint. Reuses the signal page's existing type styles (section-label, test,
// touch-detail) so it sits in the design system without new CSS. Each block renders only
// when its artifact exists, so a signal with just a briefing shows just the briefing.

function Para({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <span className="lbl" style={{ fontSize: 9.5 }}>{label}</span>
      <p style={{ margin: '5px 0 0', fontSize: 15, lineHeight: 1.6, color: 'var(--ink)' }}>{children}</p>
    </div>
  );
}

function Bullets({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <span className="lbl" style={{ fontSize: 9.5 }}>{label}</span>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--dim)', marginBottom: 4 }}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', padding: '16px 18px', marginTop: 10 }}
    >
      {children}
    </div>
  );
}

export function SignalBriefSection({ brief }: { brief: SignalBrief }) {
  return (
    <section style={{ marginTop: 30 }}>
      <div className="section-label">The briefing</div>
      <Panel>
        <Para label="What happened">{brief.what_happened}</Para>
        <Para label="Why it matters">{brief.why_it_matters}</Para>
        <Para label="What's contested">{brief.whats_contested}</Para>
        <Bullets label="What to watch next" items={brief.what_to_watch} />
      </Panel>
    </section>
  );
}

export function SignalCounterpointSection({ counterpoint }: { counterpoint: SignalCounterpoint }) {
  return (
    <section style={{ marginTop: 30 }}>
      <div className="section-label">The other read</div>
      <Panel>
        <Para label="The contrary interpretation">{counterpoint.the_other_read}</Para>
        <Bullets label="What would deflate this signal" items={counterpoint.what_would_deflate} />
      </Panel>
    </section>
  );
}

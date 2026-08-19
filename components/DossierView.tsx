import type { Dossier, BasisClaim, Basis } from '@/lib/types';
import { DOMAIN_LABEL, LENS_LABEL } from '@/lib/format';

const BASIS_META: Record<Basis, { cls: string; label: string }> = {
  web_verified: { cls: 'web', label: 'web' },
  training_memory: { cls: 'mem', label: 'memory' },
  document_stated: { cls: 'doc', label: 'stated' },
};

function ClaimList({ claims }: { claims: BasisClaim[] }) {
  if (!claims.length) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 13 }}>None.</p>;
  }
  return (
    <div>
      {claims.map((c, i) => {
        const m = BASIS_META[c.basis] ?? BASIS_META.training_memory;
        return (
          <div className="dclaim" key={i}>
            <span className="df">{c.field}</span>
            <span className="dv">{c.value}</span>
            <span className={`basis ${m.cls}`}>{m.label}</span>
            <span className="text-[11px]" style={{ color: 'var(--faint-ink)' }}>
              {Math.round(c.confidence * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span className="lbl" style={{ fontSize: 9.5 }}>{label}</span>
      <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>{children}</p>
    </div>
  );
}

function Bullets({ label, items, warn }: { label: string; items: string[]; warn?: boolean }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <span className="lbl" style={{ fontSize: 9.5, color: warn ? 'var(--heat-4)' : undefined }}>{label}</span>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--dim)', marginBottom: 3 }}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', padding: 18, marginBottom: 12 }}
    >
      <p className="lbl" style={{ marginBottom: 12 }}>{title}</p>
      {children}
    </div>
  );
}

export default function DossierView({ dossier }: { dossier: Dossier }) {
  const { document_internal: di, external_claims: ext, for_the_analyst: fa } = dossier;
  return (
    <div>
      <Panel title="The document">
        <Field label="Thesis">{di.thesis}</Field>
        <Field label="The persuasive angle">{di.what_its_selling}</Field>
        <Field label="Register & loading">
          {[di.rhetorical_register, di.emotional_loading, di.specificity].filter(Boolean).join(' · ')}
        </Field>
        <Field label="Argument quality">{di.argument_quality}</Field>
        <Bullets label="Falsifiable claims it makes" items={di.falsifiable_claims} />
        <Bullets label="Notable omissions" items={di.notable_omissions} />
        <Bullets label="Internal red flags" items={di.internal_red_flags} warn />
      </Panel>

      <Panel title="Author · external facts">
        <ClaimList claims={ext.author} />
      </Panel>
      <Panel title="Outlet · external facts">
        <ClaimList claims={ext.outlet} />
      </Panel>

      <Panel title="For analysis">
        <div
          className="rounded-[var(--radius)]"
          style={{
            background: 'color-mix(in oklab, var(--accent) 6%, var(--surface))',
            border: '1px solid color-mix(in oklab, var(--accent) 22%, var(--line))',
            padding: '12px 14px', marginBottom: 12,
          }}
        >
          <span className="lbl" style={{ fontSize: 9.5, color: 'var(--accent)' }}>Bias to model</span>
          <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>{fa.bias_to_model}</p>
        </div>
        <Bullets label="Questions to verify (most load-bearing first)" items={fa.questions_unverified} />
        <div className="flex items-center flex-wrap gap-2" style={{ marginTop: 4 }}>
          <span className="lbl" style={{ fontSize: 9.5 }}>Suggested</span>
          <span className="badge badge--accent">domain: {DOMAIN_LABEL[fa.suggested_domain_tag]}</span>
          {fa.suggested_lenses.map((l) => (
            <span key={l} className="badge">{LENS_LABEL[l]}</span>
          ))}
          <span className="text-[11px]" style={{ color: 'var(--faint-ink)' }}>not applied automatically</span>
        </div>
      </Panel>
    </div>
  );
}
